import { BUDGET_LIMITS as limits } from './pricing';

// Both scripts receive KEYS in the same order. All keys share one Redis hash slot.
const common = `
local ledger, day, month, dailyRequests, minute, user, org = unpack(KEYS)
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local owner, dayEnd, monthEnd = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3])
local reserve = ${limits.reservationMicrodollars}
local bad = {'unavailable'}

-- Use canonical decimal strings, including for counters later passed to DECRBY.
local function integer(value, max)
  if not value or (value ~= '0' and not string.match(value, '^[1-9]%d*$')) then return nil end
  local n = tonumber(value)
  if n and n <= max then return n end
end

local function counter(key, max, initial)
  local value = redis.call('GET', key)
  if not value then return initial end
  return integer(value, max)
end
`;

export const ADMIT_BUDGET =
  common +
  `
-- An automatic replay can arrive after midnight with yesterday's keys. Detect
-- its original admission before asking the caller to choose a new UTC period.
local existingOwner = redis.call('HGET', ledger, 'owner')
if existingOwner == owner then return bad end
if existingOwner then return {'duplicate'} end
if redis.call('EXISTS', ledger) == 1 then return bad end
if now < dayEnd - 86400000 or now >= dayEnd then return {'rollover'} end
local daySpend = counter(day, ${limits.dailyMicrodollars}, 0)
local monthSpend = counter(month, ${limits.monthlyMicrodollars}, 0)
local requests = counter(dailyRequests, ${limits.requestsPerDay}, 0)
if not daySpend or not monthSpend or not requests then return bad end

-- These sets are bounded by the quotas. Validate before writing: Redis Lua
-- serializes a script, but a command error does not roll back earlier writes.
local function nextSlot(key, cap, cutoff, duration)
  if redis.call('ZCARD', key) > cap then return nil end
  local entries = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
  local active, oldest = 0, nil
  for i = 2, #entries, 2 do
    local score = integer(entries[i], 8640000000000000)
    if not score then return nil end
    if score > cutoff then
      active = active + 1
      oldest = oldest or score
    end
  end
  if active >= cap then return oldest + duration end
  return 0
end

local minuteReady = nextSlot(minute, ${limits.requestsPerMinute}, now - 60000, 60000)
local userReady = nextSlot(user, ${limits.concurrentPerUser}, now, 0)
local orgReady = nextSlot(org, ${limits.concurrentPerOrg}, now, 0)
if not minuteReady or not userReady or not orgReady then return bad end
local ready = math.max(minuteReady, userReady, orgReady)
if daySpend + reserve > ${limits.dailyMicrodollars} or requests >= ${limits.requestsPerDay} then
  ready = math.max(ready, dayEnd)
end
if monthSpend + reserve > ${limits.monthlyMicrodollars} then ready = math.max(ready, monthEnd) end
if ready > now then return {'limit', math.ceil((ready - now) / 1000)} end

local function acquire(key, cutoff, score, expiry)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
  redis.call('ZADD', key, score, owner)
  redis.call('PEXPIREAT', key, expiry)
end

local deadline = now + ${limits.requestMs}
redis.call('HSET', ledger, 'owner', owner, 'deadline', deadline, 'state', 'admitting', 'count', 0)
-- Keep the ledger through the original UTC billing month. The final minute
-- covers a 45-second request admitted just before rollover and its accounting.
redis.call('PEXPIREAT', ledger, monthEnd + 60000)
redis.call('SET', day, daySpend + reserve, 'PXAT', dayEnd)
redis.call('SET', month, monthSpend + reserve, 'PXAT', monthEnd)
redis.call('SET', dailyRequests, requests + 1, 'PXAT', dayEnd)
acquire(minute, now - 60000, now, now + 60000)
acquire(user, now, deadline, deadline)
acquire(org, now, deadline, deadline)
redis.call('HSET', ledger, 'state', 'open')
return {'ok'}
`;

export const USE_BUDGET =
  common +
  `
local action, attempt, charge = ARGV[4], tonumber(ARGV[5]), ARGV[6]
local fields = redis.call('HMGET', ledger, 'owner', 'deadline', 'state', 'count')
if fields[1] ~= owner then return bad end
local deadline = integer(fields[2], 8640000000000000)
local state = fields[3]
local count = integer(fields[4], ${limits.maxAttempts})
if not deadline or not count or redis.call('HLEN', ledger) ~= 4 + count then return bad end
if state ~= 'open' and state ~= 'settled' and state ~= 'retained' then return bad end
if action == 'cancel-unpublished' then
  -- Only the private owner of an admission that never began an attempt may
  -- recover a lost admission acknowledgement as an ordinary zero-cost settle.
  if count ~= 0 then return bad end
  action = 'settle'
end

local total, uncertain, previous = 0, false, nil
for i = 1, count do
  local value = redis.call('HGET', ledger, 'attempt:' .. i)
  if value == 'pending' or value == 'unknown' then
    uncertain = true
  else
    local amount = integer(value, reserve)
    if not amount then return bad end
    total = total + amount
  end
  if i == attempt then previous = value end
end
if total > reserve then return bad end

-- The caller has independently established that it never invoked the provider.
-- A zero receipt also blocks a delayed begin that arrives after cancellation.
if action == 'cancel-unsubmitted' then
  if previous == '0' then return {'ok'} end
  if state ~= 'open' then return bad end
  if previous == 'pending' and attempt == count then
    redis.call('HSET', ledger, 'attempt:' .. attempt, '0')
  elseif not uncertain and attempt == count + 1 and attempt <= ${limits.maxAttempts} then
    redis.call('HSET', ledger, 'count', attempt, 'attempt:' .. attempt, '0')
  else
    return bad
  end
  return {'ok'}
end

if action == 'record' then
  if previous == charge then return {'ok'} end
  if state ~= 'open' or not previous then return bad end
  local field = 'attempt:' .. attempt
  -- A conflicting receipt makes the charge unknowable. Preserve that fact
  -- even when this caller receives an error or crashes before settlement.
  if previous ~= 'pending' then
    redis.call('HSET', ledger, field, 'unknown')
    return bad
  end
  if charge ~= 'unknown' then
    local amount = integer(charge, reserve - total)
    if not amount then
      redis.call('HSET', ledger, field, 'unknown')
      return bad
    end
  end
  redis.call('HSET', ledger, field, charge)
  return {'ok'}
end

local outcome = uncertain and 'retained' or 'settled'
local charged = uncertain and reserve or total
if state ~= 'open' then
  if action == 'settle' and state == outcome then return {state, charged} end
  return bad
end

-- Never recreate expired UTC buckets. A missing or depleted *current*
-- bucket means the reservation cannot be verified.
local function hasHold(key, expires, ceiling)
  if now >= expires then return true end
  local value = counter(key, ceiling, nil)
  return value and value >= reserve
end
if not hasHold(day, dayEnd, ${limits.dailyMicrodollars}) or
   not hasHold(month, monthEnd, ${limits.monthlyMicrodollars}) then return bad end

-- Check both key types before any writes. A late owner must never remove a
-- newer lease; remove only this admission's opaque member.
local userSlot = redis.call('ZSCORE', user, owner)
local orgSlot = redis.call('ZSCORE', org, owner)
if now < deadline and (tonumber(userSlot) ~= deadline or tonumber(orgSlot) ~= deadline) then
  return bad
end

if action == 'begin' then
  if uncertain or now >= deadline or attempt ~= count + 1 or attempt > ${limits.maxAttempts} then
    return bad
  end
  redis.call('HSET', ledger, 'count', attempt, 'attempt:' .. attempt, 'pending')
  return {'ok'}
end

if action ~= 'settle' then return bad end
local refund = reserve - charged
-- Latch before touching counters. Even an unexpected Redis write error must
-- never let a retry apply a second refund.
redis.call('HSET', ledger, 'state', 'settling')
if refund > 0 then
  if now < dayEnd then redis.call('DECRBY', day, refund) end
  if now < monthEnd then redis.call('DECRBY', month, refund) end
end
redis.call('ZREM', user, owner)
redis.call('ZREM', org, owner)
redis.call('HSET', ledger, 'state', outcome)
return {outcome, charged}
`;
