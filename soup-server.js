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
  { name: 'send-offer-delay', type: Number } // milliseconds
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
    participants[msg.peerId] = { webSock, mediaPeer, peerConnection, joinTs }
    console.log('setting capabilties for', msg.peerId);
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
    let desc = await pr.peerConnection.createOffer({
      offerToReceiveAudio: 1,
      offerToReceiveVideo: 1
    })
    await pr.peerConnection.setLocalDescription(desc);
    let sdp = pr.peerConnection.localDescription.sdp;
    // warn about problematic SDPs from Microsoft Edge
    if (sdp.match(/a=ssrc:\S+ msid\r/)) {    
      console.log(`warn broken offer sdp for ${peerId}`);
      console.log(sdp);
    }
    // INTRODUCE ARTIFICIAL DELAY TO ISOLATE CHROME BUG
    if (g.sendOfferDelay > 0) {
      console.log(`delaying send offer to ${peerId} by ${g.sendOfferDelay}ms`);
    }
    setTimeout(() => {
      pr.webSock.send(JSON.stringify(
        { tag: 'offer',
          sendVideo: true,
          sdp: pr.peerConnection.localDescription.serialize()
        }));
    }, g.sendOfferDelay || 0);
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


