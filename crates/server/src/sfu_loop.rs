//! Sans-IO WebRTC SFU loop using str0m.
//!
//! Manages multiple [`Rtc`] instances sharing a single UDP socket, demultiplexes
//! incoming packets, and routes media between peers based on a configurable route
//! table.

use std::collections::HashMap;
use std::fmt;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::media::{Direction, MediaData, MediaKind, Mid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

use tokio::net::UdpSocket;
use tokio::sync::{mpsc, oneshot};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Unique identifier for a peer inside the SFU loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PeerId(u64);

impl PeerId {
    /// Allocate the next unique peer id.
    pub fn next() -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        PeerId(COUNTER.fetch_add(1, Ordering::Relaxed))
    }
}

impl fmt::Display for PeerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "peer-{}", self.0)
    }
}

/// Role of a peer within a translation session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerRole {
    /// Audio Booth Connector – sends booth audio, receives translated audio.
    Abc,
    /// Translator – receives booth audio, sends translated audio.
    Translator,
    /// Listener – receives translated audio only.
    Listener,
}

/// A single media route entry: when media arrives on a source mid of a source
/// peer, forward it to `dest_peer` on `dest_mid`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaRoute {
    pub dest_peer: PeerId,
    pub dest_mid: Mid,
}

/// Commands sent **into** the SFU loop from the session manager.
pub enum SfuCommand {
    /// Accept a remote SDP offer and create a new peer.  The SFU answers
    /// immediately via the oneshot channel.
    AcceptOffer {
        peer_id: PeerId,
        role: PeerRole,
        offer_sdp: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    /// Add a trickle ICE candidate for an existing peer.
    AddIceCandidate {
        peer_id: PeerId,
        candidate: String,
    },
    /// Tear down a peer.
    RemovePeer {
        peer_id: PeerId,
    },
    /// Set (or replace) media routes for a (source_peer, source_mid) pair.
    SetRoute {
        source_peer: PeerId,
        source_mid: Mid,
        routes: Vec<MediaRoute>,
    },
    /// Remove all routes whose source is `peer_id`.
    RemoveRoutes {
        peer_id: PeerId,
    },
}

/// Events emitted **from** the SFU loop to the session manager.
#[derive(Debug)]
pub enum SfuEvent {
    /// ICE connection state changed for a peer.
    IceStateChanged {
        peer_id: PeerId,
        state: IceConnectionState,
    },
    /// A peer disconnected (or was removed).
    PeerDisconnected {
        peer_id: PeerId,
    },
    /// A new media track was detected on a peer (fired on `MediaAdded`).
    MediaAdded {
        peer_id: PeerId,
        mid: Mid,
        kind: MediaKind,
        direction: Direction,
    },
    /// Media data received from a peer — useful for recording or monitoring.
    MediaReceived {
        peer_id: PeerId,
        mid: Mid,
        kind: MediaKind,
    },
}

// ---------------------------------------------------------------------------
// Peer wrapper
// ---------------------------------------------------------------------------

struct Peer {
    id: PeerId,
    #[allow(dead_code)]
    role: PeerRole,
    rtc: Rtc,
    /// Map mid -> kind for tracks we know about.
    media_mids: HashMap<Mid, MediaKind>,
}

impl Peer {
    fn new(id: PeerId, role: PeerRole, rtc: Rtc) -> Self {
        Peer {
            id,
            role,
            rtc,
            media_mids: HashMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// SfuLoop
// ---------------------------------------------------------------------------

/// The SFU event loop.  Call [`SfuLoop::run`] from a `tokio::task::spawn_local`
/// (or a `LocalSet`) because `Rtc` is `!Send`.
pub struct SfuLoop {
    cmd_rx: mpsc::UnboundedReceiver<SfuCommand>,
    event_tx: mpsc::UnboundedSender<SfuEvent>,
}

impl SfuLoop {
    /// Create a new SFU loop and return `(loop, command_sender, event_receiver)`.
    pub fn new() -> (
        Self,
        mpsc::UnboundedSender<SfuCommand>,
        mpsc::UnboundedReceiver<SfuEvent>,
    ) {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        (SfuLoop { cmd_rx, event_tx }, cmd_tx, event_rx)
    }

    /// Run the SFU loop.  This is `async` and must be executed on a
    /// **single-threaded** tokio runtime / `LocalSet` because `Rtc` is `!Send`.
    pub async fn run(mut self) -> anyhow::Result<()> {
        // ---- bind UDP socket ------------------------------------------------
        let socket = bind_udp_socket().await?;
        let local_addr = socket.local_addr()?;
        tracing::info!("SFU loop bound to UDP {}", local_addr);

        // Determine the public IP to advertise as a host candidate.
        // 0.0.0.0 is not a valid ICE candidate address, so we must resolve
        // to a real interface IP if WEBRTC_PUBLIC_IP is not set.
        let public_ip: std::net::IpAddr = std::env::var("WEBRTC_PUBLIC_IP")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| {
                let ip = local_addr.ip();
                if ip.is_unspecified() {
                    // Bind a throwaway UDP socket to find the default route IP.
                    let probe = std::net::UdpSocket::bind("0.0.0.0:0").ok()
                        .and_then(|s| { s.connect("8.8.8.8:80").ok()?; s.local_addr().ok() })
                        .map(|a| a.ip())
                        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
                    tracing::warn!("WEBRTC_PUBLIC_IP not set, detected default route IP: {}", probe);
                    probe
                } else {
                    ip
                }
            });
        let candidate_addr = SocketAddr::new(public_ip, local_addr.port());

        // ---- state ----------------------------------------------------------
        let mut peers: HashMap<PeerId, Peer> = HashMap::new();
        let mut routes: HashMap<(PeerId, Mid), Vec<MediaRoute>> = HashMap::new();
        let mut buf = vec![0u8; 2000];

        // ---- main loop ------------------------------------------------------
        loop {
            // 1. Compute the earliest timeout across all Rtc instances.
            let mut earliest_timeout = Instant::now() + Duration::from_millis(100);

            // Poll all peers for outgoing data, events, and find next timeout.
            let peer_ids: Vec<PeerId> = peers.keys().copied().collect();
            for pid in &peer_ids {
                // We need to split borrows: poll the peer, then possibly read
                // from other peers for media routing.  Collect forwarding work
                // first.
                let mut forward_queue: Vec<(MediaData, Vec<MediaRoute>)> = Vec::new();
                let mut events_out: Vec<SfuEvent> = Vec::new();
                let mut timed_out = false;

                // Poll outputs of this one peer.
                while !timed_out {
                    let peer = match peers.get_mut(pid) {
                        Some(p) if p.rtc.is_alive() => p,
                        _ => break,
                    };

                    match peer.rtc.poll_output() {
                        Ok(Output::Timeout(t)) => {
                            earliest_timeout = earliest_timeout.min(t);
                            timed_out = true;
                        }
                        Ok(Output::Transmit(transmit)) => {
                            let _ = socket
                                .send_to(&transmit.contents, transmit.destination)
                                .await;
                        }
                        Ok(Output::Event(event)) => {
                            match event {
                                Event::IceConnectionStateChange(state) => {
                                    tracing::debug!("{}: ICE state -> {:?}", pid, state);
                                    events_out.push(SfuEvent::IceStateChanged {
                                        peer_id: *pid,
                                        state,
                                    });
                                    if state == IceConnectionState::Disconnected {
                                        peer.rtc.disconnect();
                                    }
                                }
                                Event::MediaAdded(added) => {
                                    tracing::debug!(
                                        "{}: media added mid={} kind={:?} dir={:?}",
                                        pid,
                                        added.mid,
                                        added.kind,
                                        added.direction,
                                    );
                                    peer.media_mids.insert(added.mid, added.kind);
                                    events_out.push(SfuEvent::MediaAdded {
                                        peer_id: *pid,
                                        mid: added.mid,
                                        kind: added.kind,
                                        direction: added.direction,
                                    });
                                }
                                Event::MediaData(data) => {
                                    let kind = peer
                                        .media_mids
                                        .get(&data.mid)
                                        .copied()
                                        .unwrap_or(MediaKind::Audio);
                                    events_out.push(SfuEvent::MediaReceived {
                                        peer_id: *pid,
                                        mid: data.mid,
                                        kind,
                                    });
                                    // Lookup routes.
                                    if let Some(r) = routes.get(&(*pid, data.mid)) {
                                        forward_queue.push((data, r.clone()));
                                    }
                                }
                                _ => {}
                            }
                        }
                        Err(e) => {
                            tracing::warn!("{}: poll_output error: {:?}", pid, e);
                            peer.rtc.disconnect();
                            break;
                        }
                    }
                }

                // Emit events.
                for ev in events_out {
                    let _ = self.event_tx.send(ev);
                }

                // Forward media to destination peers.
                for (data, route_list) in forward_queue {
                    for route in &route_list {
                        if let Some(dest) = peers.get_mut(&route.dest_peer) {
                            if !dest.rtc.is_alive() {
                                continue;
                            }
                            if let Some(writer) = dest.rtc.writer(route.dest_mid) {
                                if let Some(pt) = writer.match_params(data.params.clone()) {
                                    if let Err(e) = writer.write(
                                        pt,
                                        data.network_time,
                                        data.time,
                                        data.data.clone(),
                                    ) {
                                        tracing::warn!(
                                            "Failed to write media to {} mid {}: {:?}",
                                            route.dest_peer,
                                            route.dest_mid,
                                            e
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 2. Remove dead peers.
            let dead: Vec<PeerId> = peers
                .iter()
                .filter(|(_, p)| !p.rtc.is_alive())
                .map(|(id, _)| *id)
                .collect();
            for id in dead {
                tracing::info!("{}: removing dead peer", id);
                peers.remove(&id);
                routes.retain(|k, _| k.0 != id);
                // Also remove routes pointing TO this peer.
                for list in routes.values_mut() {
                    list.retain(|r| r.dest_peer != id);
                }
                let _ = self.event_tx.send(SfuEvent::PeerDisconnected { peer_id: id });
            }

            // 3. Compute sleep duration (clamped to at least 1ms).
            let sleep_dur = (earliest_timeout
                .checked_duration_since(Instant::now()))
                .unwrap_or(Duration::from_millis(1))
                .max(Duration::from_millis(1));

            // 4. select: recv UDP, recv command, or timeout
            tokio::select! {
                result = socket.recv_from(&mut buf) => {
                    match result {
                        Ok((n, source)) => {
                            let Ok(contents) = buf[..n].try_into() else {
                                continue;
                            };
                            let input = Input::Receive(
                                Instant::now(),
                                Receive {
                                    proto: Protocol::Udp,
                                    source,
                                    destination: local_addr,
                                    contents,
                                },
                            );
                            // Demux to the right peer.
                            if let Some(peer) = peers.values_mut().find(|p| p.rtc.accepts(&input)) {
                                if let Err(e) = peer.rtc.handle_input(input) {
                                    tracing::warn!("{}: handle_input error: {:?}", peer.id, e);
                                    peer.rtc.disconnect();
                                }
                            } else {
                                tracing::trace!("No peer accepts UDP from {}", source);
                            }
                        }
                        Err(e) => {
                            tracing::error!("UDP recv error: {:?}", e);
                        }
                    }
                }
                cmd = self.cmd_rx.recv() => {
                    match cmd {
                        Some(SfuCommand::AcceptOffer { peer_id, role, offer_sdp, reply }) => {
                            let result = accept_offer(
                                peer_id,
                                role,
                                &offer_sdp,
                                candidate_addr,
                                &mut peers,
                            );
                            let _ = reply.send(result);
                        }
                        Some(SfuCommand::AddIceCandidate { peer_id, candidate }) => {
                            if let Some(peer) = peers.get_mut(&peer_id) {
                                match Candidate::from_sdp_string(&candidate) {
                                    Ok(c) => {
                                        peer.rtc.add_remote_candidate(c);
                                        tracing::debug!("{}: added remote ICE candidate", peer_id);
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            "{}: bad ICE candidate: {:?}",
                                            peer_id,
                                            e
                                        );
                                    }
                                }
                            }
                        }
                        Some(SfuCommand::RemovePeer { peer_id }) => {
                            if let Some(mut peer) = peers.remove(&peer_id) {
                                peer.rtc.disconnect();
                                routes.retain(|k, _| k.0 != peer_id);
                                for list in routes.values_mut() {
                                    list.retain(|r| r.dest_peer != peer_id);
                                }
                                let _ = self.event_tx.send(SfuEvent::PeerDisconnected {
                                    peer_id,
                                });
                            }
                        }
                        Some(SfuCommand::SetRoute { source_peer, source_mid, routes: r }) => {
                            routes.insert((source_peer, source_mid), r);
                        }
                        Some(SfuCommand::RemoveRoutes { peer_id }) => {
                            routes.retain(|k, _| k.0 != peer_id);
                        }
                        None => {
                            tracing::info!("SFU command channel closed, shutting down");
                            break;
                        }
                    }
                }
                _ = tokio::time::sleep(sleep_dur) => {
                    // Drive time forward in all peers.
                    let now = Instant::now();
                    for peer in peers.values_mut() {
                        if peer.rtc.is_alive() {
                            if let Err(e) = peer.rtc.handle_input(Input::Timeout(now)) {
                                tracing::warn!("{}: timeout handle_input error: {:?}", peer.id, e);
                                peer.rtc.disconnect();
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helper: accept an SDP offer and create a new peer
// ---------------------------------------------------------------------------

fn accept_offer(
    peer_id: PeerId,
    role: PeerRole,
    offer_sdp: &str,
    candidate_addr: SocketAddr,
    peers: &mut HashMap<PeerId, Peer>,
) -> Result<String, String> {
    let offer = SdpOffer::from_sdp_string(offer_sdp).map_err(|e| format!("bad SDP offer: {e}"))?;

    let mut rtc = RtcConfig::new()
        .set_ice_lite(true)
        .build(Instant::now());

    // Add the shared UDP socket address as a host candidate.
    let candidate = Candidate::host(candidate_addr, "udp")
        .map_err(|e| format!("bad host candidate: {e}"))?;
    rtc.add_local_candidate(candidate);

    // Accept the remote offer — str0m mirrors the offered m-lines automatically.
    let answer = rtc
        .sdp_api()
        .accept_offer(offer)
        .map_err(|e| format!("accept_offer failed: {e}"))?;

    let answer_sdp = answer.to_sdp_string();

    peers.insert(peer_id, Peer::new(peer_id, role, rtc));
    tracing::info!("{}: peer created (role={:?})", peer_id, role);

    Ok(answer_sdp)
}

// ---------------------------------------------------------------------------
// Helper: bind a UDP socket within the configured port range
// ---------------------------------------------------------------------------

async fn bind_udp_socket() -> anyhow::Result<UdpSocket> {
    let port_min: u16 = std::env::var("WEBRTC_UDP_PORT_MIN")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10000);
    let port_max: u16 = std::env::var("WEBRTC_UDP_PORT_MAX")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10100);

    let bind_ip = "0.0.0.0";

    for port in port_min..=port_max {
        match UdpSocket::bind((bind_ip, port)).await {
            Ok(sock) => return Ok(sock),
            Err(_) => continue,
        }
    }

    anyhow::bail!(
        "Could not bind UDP socket in port range {}-{}",
        port_min,
        port_max
    )
}
