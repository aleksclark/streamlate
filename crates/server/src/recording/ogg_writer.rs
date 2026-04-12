use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

const OGG_CAPTURE_PATTERN: &[u8] = b"OggS";
const OPUS_HEAD_MAGIC: &[u8] = b"OpusHead";
const OPUS_TAGS_MAGIC: &[u8] = b"OpusTags";

const OPUS_SAMPLE_RATE: u32 = 48000;
const OPUS_CHANNELS: u8 = 1;
const OPUS_FRAME_DURATION_MS: u64 = 20;
const OPUS_SAMPLES_PER_FRAME: u64 = (OPUS_SAMPLE_RATE as u64) * OPUS_FRAME_DURATION_MS / 1000;

pub struct OggOpusWriter {
    file: File,
    serial: u32,
    page_sequence: u32,
    granule_position: u64,
    pages_since_flush: u32,
    flush_interval: u32,
    total_pages: u32,
}

impl OggOpusWriter {
    pub fn new(path: &Path, flush_interval: u32) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;

        let serial = rand::random::<u32>();

        let mut writer = OggOpusWriter {
            file,
            serial,
            page_sequence: 0,
            granule_position: 0,
            pages_since_flush: 0,
            flush_interval,
            total_pages: 0,
        };

        writer.write_opus_headers()?;
        Ok(writer)
    }

    fn write_opus_headers(&mut self) -> io::Result<()> {
        let mut head = Vec::with_capacity(19);
        head.extend_from_slice(OPUS_HEAD_MAGIC);
        head.push(1); // version
        head.push(OPUS_CHANNELS);
        head.extend_from_slice(&(312u16).to_le_bytes()); // pre-skip (6.5ms at 48kHz)
        head.extend_from_slice(&OPUS_SAMPLE_RATE.to_le_bytes());
        head.extend_from_slice(&(0i16).to_le_bytes()); // output gain
        head.push(0); // channel mapping family

        self.write_page(&head, 0, PAGE_FLAG_BOS)?;

        let vendor = b"streamlate";
        let mut tags = Vec::with_capacity(OPUS_TAGS_MAGIC.len() + 4 + vendor.len() + 4);
        tags.extend_from_slice(OPUS_TAGS_MAGIC);
        tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        tags.extend_from_slice(vendor);
        tags.extend_from_slice(&(0u32).to_le_bytes()); // no user comments

        self.write_page(&tags, 0, 0)?;

        self.file.flush()?;
        self.file.sync_all()?;

        Ok(())
    }

    pub fn write_opus_packet(&mut self, data: &[u8]) -> io::Result<()> {
        self.granule_position += OPUS_SAMPLES_PER_FRAME;
        self.write_page(data, self.granule_position, 0)?;

        self.pages_since_flush += 1;
        if self.pages_since_flush >= self.flush_interval {
            self.flush()?;
        }

        Ok(())
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.file.flush()?;
        self.file.sync_all()?;
        self.pages_since_flush = 0;
        Ok(())
    }

    pub fn finalize(&mut self) -> io::Result<()> {
        let eos_data: &[u8] = &[];
        self.write_page(eos_data, self.granule_position, PAGE_FLAG_EOS)?;
        self.file.flush()?;
        self.file.sync_all()?;
        Ok(())
    }

    pub fn granule_position(&self) -> u64 {
        self.granule_position
    }

    pub fn duration_seconds(&self) -> f64 {
        self.granule_position as f64 / OPUS_SAMPLE_RATE as f64
    }

    fn write_page(&mut self, data: &[u8], granule: u64, flags: u8) -> io::Result<()> {
        let segment_count = if data.is_empty() {
            1u8
        } else {
            let full_segments = data.len() / 255;
            let remainder = if data.len() % 255 != 0 || data.is_empty() {
                1
            } else {
                1
            };
            (full_segments + remainder) as u8
        };

        let mut segment_table = Vec::with_capacity(segment_count as usize);
        if data.is_empty() {
            segment_table.push(0u8);
        } else {
            let mut remaining = data.len();
            while remaining >= 255 {
                segment_table.push(255);
                remaining -= 255;
            }
            segment_table.push(remaining as u8);
        }

        let mut header = Vec::with_capacity(27 + segment_table.len());
        header.extend_from_slice(OGG_CAPTURE_PATTERN);
        header.push(0); // version
        header.push(flags);
        header.extend_from_slice(&granule.to_le_bytes());
        header.extend_from_slice(&self.serial.to_le_bytes());
        header.extend_from_slice(&self.page_sequence.to_le_bytes());
        header.extend_from_slice(&0u32.to_le_bytes()); // CRC placeholder
        header.push(segment_count);
        header.extend_from_slice(&segment_table);

        let crc = ogg_crc32(&header, data);
        header[22..26].copy_from_slice(&crc.to_le_bytes());

        self.file.write_all(&header)?;
        self.file.write_all(data)?;

        self.page_sequence += 1;
        self.total_pages += 1;

        Ok(())
    }
}

const PAGE_FLAG_BOS: u8 = 0x02;
const PAGE_FLAG_EOS: u8 = 0x04;

fn ogg_crc32(header: &[u8], data: &[u8]) -> u32 {
    static CRC_TABLE: std::sync::LazyLock<[u32; 256]> = std::sync::LazyLock::new(|| {
        let mut table = [0u32; 256];
        for i in 0..256u32 {
            let mut crc = i << 24;
            for _ in 0..8 {
                if crc & 0x80000000 != 0 {
                    crc = (crc << 1) ^ 0x04C11DB7;
                } else {
                    crc <<= 1;
                }
            }
            table[i as usize] = crc;
        }
        table
    });

    let mut crc: u32 = 0;
    for &byte in header.iter().chain(data.iter()) {
        let index = ((crc >> 24) ^ (byte as u32)) & 0xFF;
        crc = (crc << 8) ^ CRC_TABLE[index as usize];
    }
    crc
}

pub fn read_last_granule_position(path: &Path) -> io::Result<Option<u64>> {
    let data = std::fs::read(path)?;
    let mut last_granule: Option<u64> = None;

    let mut pos = 0;
    while pos + 27 <= data.len() {
        if &data[pos..pos + 4] != OGG_CAPTURE_PATTERN {
            pos += 1;
            continue;
        }

        let granule = u64::from_le_bytes(
            data[pos + 6..pos + 14]
                .try_into()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "bad granule"))?,
        );

        let num_segments = data[pos + 26] as usize;
        if pos + 27 + num_segments > data.len() {
            break;
        }

        let mut body_size: usize = 0;
        for &seg in &data[pos + 27..pos + 27 + num_segments] {
            body_size += seg as usize;
        }

        let page_size = 27 + num_segments + body_size;
        if pos + page_size > data.len() {
            break;
        }

        if granule != 0 && granule != u64::MAX {
            last_granule = Some(granule);
        }

        pos += page_size;
    }

    Ok(last_granule)
}
