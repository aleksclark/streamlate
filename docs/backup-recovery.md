# Backup & Recovery

This document covers backup procedures and disaster recovery for a Streamlate deployment.

## What to Back Up

| Component | Location | Method | Frequency |
|-----------|----------|--------|-----------|
| **Database** | `/opt/streamlate/data/streamlate.db` | SQLite backup | Daily + before upgrades |
| **Recordings** | `/opt/streamlate/data/recordings/` | rsync / filesystem snapshot | Continuous or daily |
| **Configuration** | `/opt/streamlate/config/` | Version control or copy | On change |
| **TLS certificates** | Managed by Caddy (auto) | Caddy handles renewal | N/A |

## Database Backup

### Online Backup (Recommended)

SQLite's `.backup` command creates a consistent snapshot without stopping the server:

```bash
#!/usr/bin/env bash
# /opt/streamlate/scripts/backup-db.sh

BACKUP_DIR="/opt/streamlate/backups/db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_PATH="/opt/streamlate/data/streamlate.db"

mkdir -p "$BACKUP_DIR"

sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/streamlate_$TIMESTAMP.db'"

# Keep last 30 daily backups
find "$BACKUP_DIR" -name "streamlate_*.db" -mtime +30 -delete

echo "Backup complete: $BACKUP_DIR/streamlate_$TIMESTAMP.db"
```

Schedule with cron:

```bash
# Daily at 2 AM
0 2 * * * /opt/streamlate/scripts/backup-db.sh >> /var/log/streamlate-backup.log 2>&1
```

### Verify Backup Integrity

```bash
sqlite3 /opt/streamlate/backups/db/streamlate_LATEST.db "PRAGMA integrity_check;"
# Should output: "ok"
```

## Recording Backup

Recordings are stored as files on disk. Use rsync for incremental backups:

```bash
#!/usr/bin/env bash
# /opt/streamlate/scripts/backup-recordings.sh

BACKUP_TARGET="/mnt/backup/streamlate/recordings"
SOURCE="/opt/streamlate/data/recordings/"

rsync -av --delete "$SOURCE" "$BACKUP_TARGET/"

echo "Recording backup complete"
```

For offsite backups, sync to a remote server or cloud storage:

```bash
# Remote server
rsync -avz -e ssh /opt/streamlate/data/recordings/ backup@remote:/backups/streamlate/recordings/

# S3-compatible storage (requires rclone)
rclone sync /opt/streamlate/data/recordings/ s3:streamlate-backups/recordings/
```

## Configuration Backup

Store configuration in version control:

```bash
cd /opt/streamlate/config
git init
git add -A
git commit -m "Configuration snapshot $(date +%Y%m%d)"
```

**Important**: The configuration file contains the JWT secret. Ensure the backup is encrypted or stored securely.

## Disaster Recovery

### Scenario 1: Server Crash (Data Intact)

If the server process crashes but the filesystem is intact:

```bash
# Service auto-restarts via systemd
sudo systemctl status streamlate-server

# If not running, start manually
sudo systemctl start streamlate-server

# Check logs for crash reason
sudo journalctl -u streamlate-server --since "1 hour ago"
```

### Scenario 2: Database Corruption

If the database file is corrupted:

```bash
# Stop the server
sudo systemctl stop streamlate-server

# Try to repair with SQLite
sqlite3 /opt/streamlate/data/streamlate.db ".recover" | sqlite3 /opt/streamlate/data/streamlate_recovered.db

# If recovery fails, restore from backup
cp /opt/streamlate/backups/db/streamlate_LATEST.db /opt/streamlate/data/streamlate.db

# Restart
sudo systemctl start streamlate-server
```

### Scenario 3: Full Server Loss

Complete restoration from backups to a fresh server:

```bash
# 1. Install the server (see deployment docs)
sudo mkdir -p /opt/streamlate/{bin,www,data,config,backups}
sudo useradd -r -s /usr/sbin/nologin streamlate

# 2. Install binary and web clients
# (rebuild from source or use saved release artifact)
scripts/deploy-server.sh --target user@new-server

# 3. Restore configuration
scp backup:/opt/streamlate/config/streamlate-server.toml new-server:/opt/streamlate/config/

# 4. Restore database
scp backup:/opt/streamlate/backups/db/streamlate_LATEST.db new-server:/opt/streamlate/data/streamlate.db

# 5. Restore recordings
rsync -av backup:/backups/streamlate/recordings/ new-server:/opt/streamlate/data/recordings/

# 6. Fix permissions
sudo chown -R streamlate:streamlate /opt/streamlate/data

# 7. Install and start services
sudo cp deploy/streamlate-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now streamlate-server

# 8. Verify
curl -s http://localhost:8080/api/v1/system/health | jq .
```

### Scenario 4: ABC Device Failure

If an ABC device fails:

1. Flash a new device with the ABC image (see [ABC Provisioning Guide](abc-provisioning.md))
2. Update `/etc/streamlate/abc.toml` with the same ABC ID and secret
3. Or register a new ABC in the admin panel and retire the old one

## Recovery Time Objectives

| Scenario | Expected RTO | Data Loss |
|----------|-------------|-----------|
| Server crash (auto-restart) | < 30 seconds | None |
| Database corruption (backup restore) | < 15 minutes | Since last backup |
| Full server loss | < 1 hour | Since last backup |
| ABC device failure | < 30 minutes | None (server-side) |

## Testing Your Backups

Periodically verify that backups are restorable:

```bash
# Test database backup
TEMP_DB=$(mktemp)
cp /opt/streamlate/backups/db/streamlate_LATEST.db "$TEMP_DB"
sqlite3 "$TEMP_DB" "PRAGMA integrity_check; SELECT COUNT(*) FROM users;"
rm "$TEMP_DB"

# Test full restore to a staging environment
# (recommended before production upgrades)
```

## Monitoring Backup Health

Add to your monitoring system:

```bash
# Check last backup age
LAST_BACKUP=$(ls -t /opt/streamlate/backups/db/ | head -1)
BACKUP_AGE=$(( $(date +%s) - $(stat -c %Y "/opt/streamlate/backups/db/$LAST_BACKUP") ))

if [ "$BACKUP_AGE" -gt 90000 ]; then  # 25 hours
    echo "ALERT: Database backup is stale ($BACKUP_AGE seconds old)"
fi
```
