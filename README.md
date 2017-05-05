# mediasoup-offer-delay

Chrome appears to have trouble handling mediasoup streams if there is a delay greater than about a second in processing the offer message from mediasoup to the client.

Code in this repo is a fairly concise test for reproducing this issue.

## to build and run a basic test ##
1. `npm install`
2. `npm run dev-no-https`
3. In another terminal: `node_modules/babel-cli/bin/babel-node.js soup-server.js --chrome-freeze --repl`
4. In a Chrome browser tab, load: `http://localhost:8000/soup-client.html?id=Xa`
5. Click "start" and wait for connection state to stabilize
6. In another tab, load: `http://localhost:8000/soup-client.html?id=Xb`
7. Click "start" and wait until video elements render and play in both tabs.
8. In another tab, load: `http://localhost:8000/soup-client.html?id=Xc`

On our development machines, this reliably produces a frozen video from Xb->Xa.

The flag `--chrome-freeze` triggers a code path that allows you to
adjust (in the code) the timing of the offer send (or anything else in
the `createOffer()` send sequence) for each individual client.

At the moment with `--chrome-freeze` set, the test code does the following:

1. Client A joins the room. We delay sending the offer by 1s.
2. Client B joins the room. We delay sending the offer to B for 1s. After offer/answer exchange with B, onnegotiationneeded fires for Client A. We delay sending the new offer to A by one second. Offer/answer exchange completes and video streams play fine in both clients.
3. Client C joins the room. We delay sending the offer to C for 1s. After offer/answer exchange with C both B->C and A-C streams play fine in Client C. onnegotionneeded fires for Clients A and B. At that point as soon as the mediasoup js code calls createOffer on the RTCPeerConnection for Client A, the video stream B->A freezes in Chrome. We do not send the offer to A. (We do send the offer to B, as normal, with no delay, just to show that all streams are working in B. But this doesn't change the buggy behavior in Client A either way.)

Different permutations of delay in sending/processing the offer messages create somewhat different behavior in the first Chrome tab. If you do send the renegotiation offer to A, Usually the video from Xc->Xa is fine. But sometimes no bytes are sent for that stream. Sometimes the video from Xb->Xa is market by Chrome as "muted=true".

You can also start the test server with the flag --send-offer-delay=[num]ms. That flag simply forces a global delay before each offer send.

Finally, the --repl flag starts a repl within the server process, so that you can inspect the state of the mediasoup server, peers, etc. For example, from the repl, typing `g.sfu` will access the mediasoup server object.

## test environment ##

Chrome 58.0.3029.81
Ubuntu Linux 16.04
Node 6.3.0
