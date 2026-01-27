# Infrasight V2 Operational Runbook

Operational procedures for monitoring, debugging, maintenance, and incident response.

## Table of Contents

- [System Architecture](#system-architecture)
- [Health Monitoring](#health-monitoring)
- [Common Debugging Procedures](#common-debugging-procedures)
- [Operational Procedures](#operational-procedures)
- [Incident Response](#incident-response)
- [Rollback Procedures](#rollback-procedures)
- [Maintenance Procedures](#maintenance-procedures)
- [Troubleshooting Reference](#troubleshooting-reference)

---

## System Architecture

### Component Diagram

```
+-------------------+       +-------------------+       +-------------------+
|                   |       |                   |       |                   |
|   Browser/Client  | <---> |   Next.js App     | <---> |    MongoDB        |
|   (React + Pusher)|       |   (API Routes)    |       |   (Atlas/Local)   |
|                   |       |                   |       |                   |
+-------------------+       +-------------------+       +-------------------+
         ^                          |                            |
         |                          v                            |
         |                  +-------------------+                |
         |                  |                   |                |
         +------------------|   Pusher          |                |
                            |   (WebSocket)     |                |
                            |                   |                |
                            +-------------------+                |
                                                                 |
                            +-------------------+                |
                            |                   |<---------------+
                            |   Redis           |
                            |   (Rate Limiting) |
                            |                   |
                            +-------------------+
```

### Data Flow

1. **Sensor Data Ingestion**:

   ```
   IoT Sensors -> POST /api/v2/readings/ingest -> MongoDB (readings_v2)
                                               -> Pusher (real-time)
   ```

2. **Dashboard Display**:

   ```
   Browser -> GET /api/v2/devices -> MongoDB (devices_v2)
           -> Subscribe Pusher -> Live updates
   ```

3. **Analytics Queries**:
   ```
   Browser -> GET /api/v2/analytics/* -> MongoDB Aggregation
   ```

### Critical Dependencies

| Service | Purpose                 | Failure Impact                           |
| ------- | ----------------------- | ---------------------------------------- |
| MongoDB | Primary data store      | Complete system failure                  |
| Pusher  | Real-time updates       | Live updates disabled                    |
| Redis   | Rate limiting & caching | Rate limiting disabled, slower responses |
| Sentry  | Error tracking          | No error visibility                      |

---

## Health Monitoring

### Health Check Endpoints

| Endpoint                       | Purpose               | Expected Response    |
| ------------------------------ | --------------------- | -------------------- |
| `GET /api/v2/analytics/health` | Device health metrics | 200 with health data |
| `GET /api/v2/metadata`         | System metadata       | 200 with metadata    |

### Key Metrics to Monitor

#### Application Metrics

| Metric                  | Warning Threshold | Critical Threshold | Action                    |
| ----------------------- | ----------------- | ------------------ | ------------------------- |
| API Response Time (p95) | > 500ms           | > 2000ms           | Check database indexes    |
| Error Rate              | > 1%              | > 5%               | Check Sentry for details  |
| Active Device Count     | < 90% of expected | < 80% of expected  | Check offline devices     |
| Reading Ingestion Rate  | < 80% of expected | < 50% of expected  | Check sensor connectivity |
| Memory Usage            | > 70%             | > 90%              | Check for memory leaks    |

#### Database Metrics

| Metric                | Warning Threshold | Critical Threshold | Action              |
| --------------------- | ----------------- | ------------------ | ------------------- |
| Connection Pool Usage | > 80%             | > 95%              | Scale connections   |
| Query Execution Time  | > 100ms avg       | > 500ms avg        | Review slow queries |
| Collection Size       | > 80% of capacity | > 95% of capacity  | Archive old data    |
| Index Miss Rate       | > 10%             | > 30%              | Add missing indexes |

#### Real-time Metrics

| Metric                  | Warning Threshold | Critical Threshold | Action              |
| ----------------------- | ----------------- | ------------------ | ------------------- |
| Pusher Connection Count | > 80% of limit    | > 95% of limit     | Scale Pusher plan   |
| Message Rate            | > 80% of limit    | > 95% of limit     | Throttle broadcasts |
| Connection Errors       | > 1/min           | > 10/min           | Check Pusher status |

### Health Check Script

```bash
#!/bin/bash
# health-check.sh

API_URL="${API_URL:-http://localhost:3000}"

# Check health endpoint
echo "Checking health endpoint..."
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/api/v2/analytics/health")
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | tail -n 1)

if [ "$HEALTH_STATUS" != "200" ]; then
  echo "CRITICAL: Health endpoint returned $HEALTH_STATUS"
  exit 2
fi

HEALTH_DATA=$(echo "$HEALTH_RESPONSE" | head -n -1)
HEALTH_SCORE=$(echo "$HEALTH_DATA" | jq -r '.data.summary.health_score')

if [ "$HEALTH_SCORE" -lt 80 ]; then
  echo "WARNING: Health score is $HEALTH_SCORE%"
  exit 1
fi

echo "OK: Health score is $HEALTH_SCORE%"
exit 0
```

### Setting Up Alerts

#### Sentry Alerts

1. Navigate to Sentry > Alerts > Create Alert Rule
2. Configure alert conditions:
   - **Error frequency**: More than 10 errors in 5 minutes
   - **New issues**: Any new unhandled error
   - **Performance**: p95 latency > 2 seconds

#### MongoDB Atlas Alerts

1. Navigate to Atlas > Project > Alerts
2. Configure alerts for:
   - Connection count > 80% of limit
   - Disk usage > 80%
   - Slow queries > 100ms average

---

## Common Debugging Procedures

### Device Not Updating

**Symptoms**: Device shows as "offline" or readings not updating

**Debugging Steps**:

```bash
# 1. Check device status in database
mongosh --eval "
  db.devices_v2.findOne({ _id: 'device_001' }, {
    'health.last_seen': 1,
    status: 1,
    'audit.deleted_at': 1
  })
"

# 2. Check recent readings for the device
mongosh --eval "
  db.readings_v2.find({
    'metadata.device_id': 'device_001'
  }).sort({ timestamp: -1 }).limit(5)
"

# 3. Check if readings are being ingested (API logs)
# Look for POST /api/v2/readings/ingest requests

# 4. Verify Pusher connection
# Check browser console for Pusher connection status
# Look for "Pusher connected" or error messages
```

**Resolution**:

| Finding                   | Resolution                                        |
| ------------------------- | ------------------------------------------------- |
| `audit.deleted_at` exists | Device was soft-deleted. Restore if needed.       |
| No recent readings        | Check sensor connectivity and ingestion endpoint. |
| `last_seen` is recent     | Device is reporting; check Pusher subscription.   |
| Status is "error"         | Check `health.last_error` for details.            |

### High Error Rates

**Symptoms**: Increased error responses, Sentry alerts

**Debugging Steps**:

```bash
# 1. Check Sentry for error patterns
# Navigate to Sentry > Issues > Sort by frequency

# 2. Check API error distribution
curl -s "http://localhost:3000/api/v2/metrics" | grep error

# 3. Check database connection
mongosh --eval "db.serverStatus().connections"

# 4. Check recent error logs
# Review application logs for ERROR level entries
```

**Common Causes and Resolutions**:

| Error Pattern         | Cause                | Resolution                   |
| --------------------- | -------------------- | ---------------------------- |
| `VALIDATION_ERROR`    | Invalid API requests | Check client-side validation |
| `DATABASE_ERROR`      | MongoDB issues       | Check connection, indexes    |
| `CONNECTION_ERROR`    | Network issues       | Verify network, DNS          |
| `RATE_LIMIT_EXCEEDED` | Too many requests    | Adjust rate limits or scale  |

### Performance Issues

**Symptoms**: Slow API responses, high latency

**Debugging Steps**:

```bash
# 1. Check slow queries in MongoDB
mongosh --eval "
  db.setProfilingLevel(2);
  // Wait for some queries...
  db.system.profile.find({ millis: { \$gt: 100 } }).limit(10)
"

# 2. Check index usage
mongosh --eval "
  db.readings_v2.aggregate([
    { \$indexStats: {} }
  ])
"

# 3. Check collection stats
mongosh --eval "
  db.readings_v2.stats()
"

# 4. Verify indexes exist
mongosh --eval "
  db.readings_v2.getIndexes()
"
```

**Resolution**:

| Finding              | Resolution                     |
| -------------------- | ------------------------------ |
| Full collection scan | Add appropriate index          |
| Large result sets    | Add pagination, limit results  |
| Index not used       | Restructure query to use index |
| Large documents      | Consider field projection      |

### Real-time Not Working

**Symptoms**: Dashboard not updating in real-time

**Debugging Steps**:

1. **Check browser console**:

   ```javascript
   // Look for Pusher connection status
   Pusher.log = function (msg) {
     console.log(msg);
   };
   ```

2. **Verify Pusher credentials**:

   ```bash
   echo "NEXT_PUBLIC_PUSHER_KEY: $NEXT_PUBLIC_PUSHER_KEY"
   echo "NEXT_PUBLIC_PUSHER_CLUSTER: $NEXT_PUBLIC_PUSHER_CLUSTER"
   ```

3. **Test Pusher connection**:
   - Navigate to Pusher Dashboard > Debug Console
   - Check for connection attempts and events

4. **Verify event names match**:
   - Server sends: `pusher.trigger('sensor-readings', 'new-reading', data)`
   - Client subscribes: `channel.bind('new-reading', callback)`

**Resolution**:

| Finding             | Resolution                         |
| ------------------- | ---------------------------------- |
| Connection refused  | Check Pusher credentials           |
| Events not received | Verify channel and event names     |
| CORS errors         | Check Pusher cluster configuration |
| Rate limited        | Scale Pusher plan                  |

---

## Operational Procedures

### Database Backup

#### MongoDB Atlas (Automated)

Atlas provides automated daily backups. To restore:

1. Navigate to Atlas > Clusters > Backup
2. Select snapshot to restore
3. Choose "Restore to this cluster" or "Restore to another cluster"

#### Manual Backup (Local)

```bash
#!/bin/bash
# backup-mongodb.sh

BACKUP_DIR="/backups/mongodb/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

mongodump \
  --uri="$MONGODB_URI" \
  --out="$BACKUP_DIR" \
  --gzip

# Upload to S3 (optional)
aws s3 sync "$BACKUP_DIR" "s3://infrasight-backups/mongodb/$(date +%Y-%m-%d)/"

echo "Backup completed: $BACKUP_DIR"
```

### Database Restore

```bash
#!/bin/bash
# restore-mongodb.sh

BACKUP_DIR=$1

if [ -z "$BACKUP_DIR" ]; then
  echo "Usage: $0 <backup_directory>"
  exit 1
fi

# Drop existing data (CAUTION!)
mongosh --eval "db.dropDatabase()"

# Restore from backup
mongorestore \
  --uri="$MONGODB_URI" \
  --gzip \
  "$BACKUP_DIR"

# Recreate indexes
pnpm create-indexes-v2

echo "Restore completed from: $BACKUP_DIR"
```

### Index Maintenance

```bash
#!/bin/bash
# maintain-indexes.sh

# Verify V2 indexes exist
pnpm verify-indexes

# Create any missing indexes
pnpm create-indexes-v2

# Check index usage
mongosh --eval "
  print('Device indexes:');
  db.devices_v2.getIndexes().forEach(printjson);

  print('Reading indexes:');
  db.readings_v2.getIndexes().forEach(printjson);
"
```

### Cache Invalidation

```bash
# Clear all cached data
curl -X POST "http://localhost:3000/api/v2/cache/clear" \
  -H "X-API-Key: admin-key"

# Or via Redis CLI
redis-cli FLUSHDB
```

### Log Rotation

Configure log rotation for production:

```bash
# /etc/logrotate.d/infrasight
/var/log/infrasight/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        systemctl reload infrasight
    endscript
}
```

---

## Incident Response

### Severity Levels

| Level         | Description            | Response Time | Examples                              |
| ------------- | ---------------------- | ------------- | ------------------------------------- |
| P0 (Critical) | System down, data loss | < 15 minutes  | Database unreachable, data corruption |
| P1 (High)     | Major feature broken   | < 1 hour      | Real-time updates not working         |
| P2 (Medium)   | Minor feature broken   | < 4 hours     | Specific API endpoint failing         |
| P3 (Low)      | Cosmetic issues        | < 24 hours    | UI display issues                     |

### Incident Response Workflow

```
1. ACKNOWLEDGE
   ├── Confirm incident receipt
   ├── Log incident start time
   └── Notify stakeholders

2. ASSESS
   ├── Determine severity
   ├── Identify affected systems
   └── Estimate user impact

3. INVESTIGATE
   ├── Check monitoring dashboards
   ├── Review error logs
   ├── Check recent deployments
   └── Identify root cause

4. MITIGATE
   ├── Apply temporary fix OR
   ├── Rollback if needed OR
   └── Scale resources

5. RESOLVE
   ├── Implement permanent fix
   ├── Verify fix works
   └── Monitor for recurrence

6. POST-MORTEM (P0/P1 only)
   ├── Document timeline
   ├── Identify root cause
   ├── List action items
   └── Share learnings
```

### Incident Communication Templates

#### Initial Alert

```
INCIDENT: [Brief Description]
SEVERITY: P[0-3]
TIME: [Start Time UTC]
IMPACT: [Number of users/systems affected]
STATUS: Investigating

Next update in: [Time]
```

#### Update

```
INCIDENT UPDATE: [Brief Description]
SEVERITY: P[0-3]
STATUS: [Investigating/Mitigating/Resolved]
PROGRESS: [What we've learned/done]

Next update in: [Time]
```

#### Resolution

```
INCIDENT RESOLVED: [Brief Description]
DURATION: [Total time]
ROOT CAUSE: [Brief explanation]
FIX: [What was done]

Post-mortem scheduled: [Date/Time]
```

---

## Rollback Procedures

### Code Rollback (Vercel)

```bash
# List recent deployments
vercel list

# Rollback to previous deployment
vercel rollback <deployment-url>

# Or promote a specific deployment
vercel promote <deployment-url>
```

### Code Rollback (Docker)

```bash
# List available images
docker images infrasight

# Rollback to previous version
docker stop infrasight
docker run -d --name infrasight \
  --env-file .env.production \
  -p 3000:3000 \
  infrasight:previous-tag
```

### Code Rollback (Git)

```bash
# Identify commit to rollback to
git log --oneline -10

# Create rollback commit
git revert HEAD
git push origin main

# Or hard reset (CAUTION - destructive)
git reset --hard <commit-sha>
git push --force origin main
```

### Database Rollback

```bash
# Restore from backup (see Database Restore section)
./restore-mongodb.sh /backups/mongodb/2026-01-04

# Verify data integrity
mongosh --eval "
  print('Devices:', db.devices_v2.countDocuments());
  print('Readings:', db.readings_v2.countDocuments());
"

# Recreate indexes
pnpm create-indexes-v2
```

### Rollback Verification Checklist

- [ ] Application is accessible
- [ ] Health endpoint returns 200
- [ ] Device list loads correctly
- [ ] Readings are being ingested
- [ ] Real-time updates working
- [ ] No new errors in Sentry
- [ ] Database connections stable

---

## Maintenance Procedures

### Scheduled Maintenance Window

**Pre-Maintenance Checklist**:

- [ ] Notify users of maintenance window
- [ ] Create database backup
- [ ] Verify rollback procedure
- [ ] Have support team on standby

**Post-Maintenance Checklist**:

- [ ] Verify all services are running
- [ ] Check health endpoints
- [ ] Verify real-time updates
- [ ] Monitor error rates for 30 minutes
- [ ] Notify users of completion

### Database Maintenance

#### TTL Cleanup (Automatic)

Readings collection has automatic TTL cleanup (90 days). No manual action required.

#### Index Rebuild (Monthly)

```bash
# Schedule during low-traffic period
mongosh --eval "
  // Rebuild indexes (blocking)
  db.devices_v2.reIndex();
  db.readings_v2.reIndex();
"
```

#### Collection Stats Check (Weekly)

```bash
mongosh --eval "
  print('=== Collection Statistics ===');

  print('\\nDevices:');
  printjson(db.devices_v2.stats());

  print('\\nReadings:');
  printjson(db.readings_v2.stats());
"
```

### Dependency Updates

```bash
# Check for updates
pnpm outdated

# Update patch versions (safe)
pnpm update

# Update all versions (review changelog first)
pnpm update --latest

# Test after updates
pnpm test
pnpm build
```

### Security Patching

1. Subscribe to security advisories:
   - [Next.js Security](https://github.com/vercel/next.js/security/advisories)
   - [MongoDB Security](https://www.mongodb.com/alerts)
   - [npm Security](https://www.npmjs.com/advisories)

2. Run security audit:

   ```bash
   pnpm audit
   ```

3. Apply patches:
   ```bash
   pnpm audit fix
   ```

---

## Troubleshooting Reference

### Quick Reference

| Symptom         | First Check           | Second Check       | Resolution                        |
| --------------- | --------------------- | ------------------ | --------------------------------- |
| 500 errors      | Sentry issues         | MongoDB status     | Review logs, check connections    |
| Slow responses  | MongoDB slow queries  | Index usage        | Add indexes, optimize queries     |
| No real-time    | Browser console       | Pusher debug       | Verify credentials, channel names |
| Devices offline | `last_seen` timestamp | Ingestion endpoint | Check sensor connectivity         |
| High memory     | Application logs      | Heap usage         | Check for memory leaks            |
| Rate limited    | Rate limit logs       | Redis status       | Adjust limits or scale            |

### MongoDB Troubleshooting

```bash
# Check connection status
mongosh --eval "db.serverStatus().connections"

# Check current operations
mongosh --eval "db.currentOp()"

# Kill long-running operation
mongosh --eval "db.killOp(<opid>)"

# Check replica set status (if applicable)
mongosh --eval "rs.status()"
```

### Redis Troubleshooting

```bash
# Check connection
redis-cli ping

# Check memory usage
redis-cli info memory

# Check connected clients
redis-cli client list

# Clear rate limit keys (emergency)
redis-cli KEYS "ratelimit:*" | xargs redis-cli DEL
```

### Application Troubleshooting

```bash
# Check running processes
ps aux | grep node

# Check port usage
lsof -i :3000

# Check environment variables
env | grep -E "(MONGODB|PUSHER|REDIS)"

# Test API endpoint
curl -v "http://localhost:3000/api/v2/analytics/health"
```

### Network Troubleshooting

```bash
# Test MongoDB connectivity
nc -zv <mongodb-host> 27017

# Test Pusher connectivity
curl -v "https://api-<cluster>.pusher.com/"

# Test Redis connectivity
nc -zv <redis-host> 6379

# Check DNS resolution
nslookup <hostname>
```

---

## Emergency Contacts

| Role                | Contact | Escalation    |
| ------------------- | ------- | ------------- |
| Primary On-Call     | [Name]  | [Phone/Slack] |
| Secondary On-Call   | [Name]  | [Phone/Slack] |
| Database Admin      | [Name]  | [Phone/Slack] |
| Infrastructure Lead | [Name]  | [Phone/Slack] |
| Engineering Manager | [Name]  | [Phone/Slack] |

---

## Useful Commands Quick Reference

```bash
# Health check
curl "http://localhost:3000/api/v2/analytics/health"

# Database backup
mongodump --uri="$MONGODB_URI" --out=/backups/$(date +%Y-%m-%d)

# Recreate indexes
pnpm create-indexes-v2

# Clear cache
redis-cli FLUSHDB

# Check logs (Vercel)
vercel logs --follow

# Rollback (Vercel)
vercel rollback

# Restart application (systemd)
sudo systemctl restart infrasight

# Check disk space
df -h

# Check memory
free -m
```

---

_Last Updated: 2026-01-05_
