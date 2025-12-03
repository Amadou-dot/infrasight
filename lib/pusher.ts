import Pusher from 'pusher';

const appId = process.env.PUSHER_APP_ID;
const key = process.env.PUSHER_KEY;
const secret = process.env.PUSHER_SECRET;
const cluster = process.env.PUSHER_CLUSTER;
console.log(appId);
console.log(key);
console.log(secret);
console.log(cluster);

if (!appId || !key || !secret || !cluster) {
  throw new Error(
    `Missing Pusher environment variables. Found: appId=${!!appId}, key=${!!key}, secret=${!!secret}, cluster=${!!cluster}`
  );
}

export const pusherServer = new Pusher({
  appId,
  key,
  secret,
  cluster,
  useTLS: true,
});
