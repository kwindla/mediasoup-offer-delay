# mediasoup-offer-delay

Chrome appears to have trouble handling mediasoup streams if there is a delay greater than about a second in processing the offer message from mediasoup to the client.

Code in this repo is a fairly concise test for reproducing this issue.

## to build and run a basic test ##
1. `npm install`
2. `npm run dev-no-https`
3. In another terminal: `node_modules/babel-cli/bin/babel-node.js soup-server.js --send-offer-delay=1000`
4. In a Chrome browser tab, load: `http://localhost:8000/soup-client.html?id=Xa`
5. Click "start" and wait for connection state to stabilize
6. In another tab, load: `http://localhost:8000/soup-client.html?id=Xb`
7. Click "start" and wait until video elements render and play in both tabs.
8. In another tab, load: `http://localhost:8000/soup-client.html?id=Xc`

On our development machines, this reliably produces a frozen video from Xb->Xa, and often leaves the video from Xc->Xa in a non-playing state.

Different permutations of delay in sending/processing the offer messages create somewhat different behavior in the first Chrome tab. Usually the video from Xc->Xa is fine. But sometimes no bytes are sent for that stream. Sometimes the video from Xb->Xa is market by Chrome as "muted=true".

## test environment ##

Chrome 58.0.3029.81
Ubuntu Linux 16.04
Node 6.3.0
