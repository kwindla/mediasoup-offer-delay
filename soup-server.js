import cmdLineArgs from 'command-line-args';
import mediasoup from 'mediasoup';
import WebSocket from 'ws';
import repl from 'repl';

import {
  remove,
  find,
  sortBy,
  reverse,
} from 'lodash';

const cmdLineOpts = cmdLineArgs([
  { name: 'ip', type: String },
  { name: 'repl', type: Boolean },
  { name: 'pause-on-start', type: Boolean },
  { name: 'send-offer-delay', type: Number }, // milliseconds
  { name: 'chrome-freeze', type: Boolean }
]);

const serverOpts = {
  logLevel: 'debug',
  numWorkers: 1,
  rtcIPv4: true,
  rtcIPv6: false,
  rtcMinPort: 40000,
  rtcMaxPort: 49999,
};
if (cmdLineOpts.ip) {
  serverOpts.rtcAnnouncedIPv4 = cmdLineOpts.ip;
}

const roomOptions = {
  mediaCodecs : [
    {
      kind        : "audio",
      name        : "audio/opus",
      clockRate   : 48000,
      payloadType : 100
    },
    {
      kind        : "video",
      name        : "video/vp8",
      clockRate   : 90000,
      payloadType : 123
    }
  ]
};

const RTCPeerConnection = mediasoup.webrtc.RTCPeerConnection;

let participants = {},
    sfu,
    soupRoom;

if (cmdLineOpts['send-offer-delay'] > 0 &&
    cmdLineOpts['chrome-freeze']) {
  console.error('please provide only one of --send-offer-delay or --chrome-freeze');
  process.exit(1);
}

// setup websocket for test signaling
const wss = new WebSocket.Server({ port: 8123 });
global.wss = wss;
wss.on('connection', (webSock) => {
  webSock.on('message', handleIncomingWebSocketMessage.bind(null, webSock));
  webSock.on('close', () => {
    let peerId = find(
      Object.keys(participants),
      (id) => participants[id].webSock === webSock
    );
    if (peerId) {
      console.log(`${peerId} websocket closed`);
      if (participants[peerId].mediaPeer) {
        participants[peerId].mediaPeer.close();
      }
      if (participants[peerId].peerConnection) {
        participants[peerId].peerConnection.close();
      }
      delete participants[peerId];
    } else {
      console.log('unknown websocket closed (huh?)');
    }
    console.log('participant count:', Object.keys(participants).length);
  });
});

async function main () {
  try {
    sfu = mediasoup.Server(serverOpts);
    soupRoom = await sfu.createRoom(roomOptions);
    sfuInternalsDump();
  } catch (e) {
    console.error(e);
  }
}

// ---- 

if (!cmdLineOpts['pause-on-start']) {
  main();
}

// -- optional repl --
const g = {
  sendOfferDelay: cmdLineOpts['send-offer-delay'] || 0,
  cmdLineOpts,
  sfu,
  participants,
  soupRoom,
  main,
};
if (cmdLineOpts.repl) {
  repl.start('> ').context.g = g;
}

// ----

function handleIncomingWebSocketMessage (webSock, messageText) {
  let msg = JSON.parse(messageText);
  console.log(`${msg.peerId} incoming ${msg.tag} message`);
  switch (msg.tag) {
    case 'join':
      handleParticipant(webSock, msg)
      break;
    case 'answer':
      handleAnswer(webSock, msg);
      break;
  }
}

async function handleParticipant (webSock, msg) {
  try {
    webSock.soupClientPeerId = msg.peerId;
    let mediaPeer = soupRoom.Peer(msg.peerId),
        usePlanB = !msg.peerId.match(/^U/);
    console.log(`using plan b for ${msg.peerId}`, usePlanB);
    let peerConnection = new RTCPeerConnection({
      peer: mediaPeer,
      usePlanB: usePlanB,
    });
    let joinTs = Date.now();
    let joinSeqNum = Object.keys(participants).length;
    participants[msg.peerId] = { webSock, mediaPeer, peerConnection,
                                 joinTs, joinSeqNum };
    console.log('setting capabilties for', msg.peerId, joinSeqNum);
    await peerConnection.setCapabilities(msg.capabilities);
    sendSdpOffer(msg.peerId);
    peerConnection.on('negotiationneeded', () => {
      console.log('negotiation needed for', msg.peerId);
      sendSdpOffer(msg.peerId);
    });
    console.log('participant count:', Object.keys(participants).length);
  } catch (e) {
    console.error(e);
  }
}

async function handleAnswer (webSock, msg) {
  let peerId = msg.peerId,
      pr = participants[peerId];
  if (!pr) {
    console.error('sendSdpOffer called on unknown peerId', peerId);
    return;
  }
  try {
    await pr.peerConnection.setRemoteDescription(msg.sdp);
  } catch (e) {
    console.error(e);
    pr.peerConnection.reset();
  }
}

async function sendSdpOffer (peerId) {
  let pr = participants[peerId];
  if (!pr) {
    console.error('sendSdpOffer called on unknown peerId', peerId);
    return;
  }
  try {
    // INTRODUCE ARTIFICIAL DELAY TO ISOLATE CHROME BUG
    // Two ways of doing this.
    // 1. --send-offer-delay / g.sendOfferDelay specifies a global
    // delay in ms. A delay of approximately 1,000ms or more triggers
    // stream B->A freezing in Chrome when client C joins.
    // 2. Alternatively, --chrome-freeze treats each connection
    // uniquely. Setting delay for the second and third peer that
    // join, and only doing the create offer, not the send, for the
    // third peer.
    let peersCnt = Object.keys(participants).length,
        delay = 0;
    if (g.sendOfferDelay) {
      delay = g.sendOfferDelay;
    } else if (cmdLineOpts['chrome-freeze']) {
      if (peersCnt === 1) {
        console.log('sending initial offer to Client A');
        delay = 1000;
      } else if (peersCnt === 2) {
        if (pr.joinSeqNum === 0) {
          console.log('sending renegotiation offer to Client A');
          delay = 1000;
        } else if (pr.joinSeqNum === 1) {
          console.log('sending initial offer to Client B');
          delay = 1000;
        }
      } else if (peersCnt === 3) {
        if (pr.joinSeqNum === 0) {
          console.log('doing createOffer for Client A, but *not* sending sdp');
          let desc = await pr.peerConnection.createOffer({
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 1
          });
          return;
        } else if (pr.joinSeqNum === 1) {
          console.log('sending renegotiation offer to Client B');
          delay = 0;
        } else if (pr.joinSeqNum === 2) {
          console.log('sending initial offer to Client C');
          delay = 0;
        }
      }
    }

    let desc = await pr.peerConnection.createOffer({
      offerToReceiveAudio: 1,
      offerToReceiveVideo: 1
    });
    await pr.peerConnection.setLocalDescription(desc);
    let sdp = pr.peerConnection.localDescription.sdp;
    // warn about problematic SDPs from Microsoft Edge
    if (sdp.match(/a=ssrc:\S+ msid\r/)) {    
      console.log(`warn broken offer sdp for ${peerId}`);
      console.log(sdp);
    }
    if (delay > 0) {
      console.log(`delaying send offer to ${peerId} by ${delay}ms`);
    }    
    setTimeout(() => {
      pr.webSock.send(JSON.stringify(
        { tag: 'offer',
          sendVideo: true,
          sdp: pr.peerConnection.localDescription.serialize()
        }));
    }, delay);
  } catch (e) {
    console.error(e);
    pr.peerConnection.reset();
  }
}

function sfuInternalsDump() {
  sfu.dump()
     .then((internals) => {
       console.log('--- sfu internals ---\n', JSON.stringify(internals),
                 '\n---------------------');
     })
    .catch((e) => {
      console.error(e);
    });
}


