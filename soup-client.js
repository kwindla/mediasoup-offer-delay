import queryString from 'querystring';
import {
  remove,
  find,
} from 'lodash';

let webSock;

// URL arguments can be:
//   - id = <String>
//   - autojoin = <Truthy>
//   - ws = <String>

let config = queryString.parse(window.location.search.substring(1)),
    localId = config.id || Math.floor((Math.random()*999000)),
    rtc,
    remoteStreams = [],
    localStream;

window.main = async function() {
  console.log('test client configuration', config);
  window.rtc = rtc;
  window.remoteStreams = remoteStreams;
  window.localStream = localStream;
  if (config.autojoin) {
    console.log('autojoining');
    window.start();
  }
}

window.start = async function() {
  let wsAddr = config.ws || 'ws://localhost:8123/';
  console.log('connecting to websocket' + wsAddr);
  webSock = new WebSocket(wsAddr);
  webSock.onmessage = (event) => handleIncomingMessage(event.data);
  webSock.onerror = function (e) {
    console.error('websocket error', e);
  }
  webSock.onopen = join;
}

async function join() {
  try {
    localStream = await getUserMedia();
    rtc = new RTCPeerConnection(
      { iceServers: [{"url":"stun:stun.l.google.com:19302"}] }
    );
    rtc.onicecandidate = onIceCandidate
    rtc.onsignalingstatechange = onSignalingStateChange;
    rtc.onconnectionstatechange =onConnectionStateChange;
    rtc.onaddstream = (evt) => addStream(evt.stream);
    rtc.onremovestream = (evt) => removeStream(evt.stream);
    console.log('doing initial createOffer call to fetch capabilities');
    let desc = await rtc.createOffer({
      offerToReceiveAudio: 1,
      offerToReceiveVideo: 1
    });
    console.log('sending capabilities', desc);
    webSock.send(JSON.stringify(
      { peerId: localId,
        tag: 'join',
        capabilities: desc.sdp }
    ));
  } catch (e) {
    console.error(e);
  };
}

// -- peer connection state --

function onIceCandidate (evt) {
  console.log('onIceCandidate', evt.candidate);
}

function onSignalingStateChange (evt) {
  console.log('onSignalingStateChange', evt.currentTarget.signalingState);
}

function onConnectionStateChange (evt) {
  console.log('onConnectionStateChange', evt.currentTarget.iceConnectionState);
}

// -- keep track of and display new streams --

function addStream (stream) {
  console.log('adding remote stream', stream);
  remoteStreams.push(stream);
  addVideoElementForStream(stream);
}

function removeStream (stream) {
  console.log('removing remote stream', stream);
  remove(remoteStreams, (s) => s.id === stream.id);
  removeVideoElementForStream(stream);
}

function addVideoElementForStream (stream) {
  console.log('creating new video element for', stream);
  let div = document.getElementById('video-playback');
  let video = document.createElement('video');
  video.streamId = stream.id;
  video.src = window.URL.createObjectURL(stream);
  div.appendChild(video);
  video.addEventListener('loadedmetadata', () => {
    console.log('ready to play', video);
    video.play();
  });
}

function removeVideoElementForStream (stream) {
  let div = document.getElementById('video-playback');
  let vid = find(div.children, (el) => el.streamId == stream.id);
  if (!vid) {
    console.error('could not find video element to remove for', stream);
    return;
  }
  div.removeChild(vid);
}

// -- getUserMedia wrapper --

async function getUserMedia() {
  const stream = await navigator.mediaDevices.getUserMedia(
    { audio: true,
      video: {
        width: { min: 640, max: 640 },
        height:{ min: 360, max: 360 },
      }
    }
  );
  return stream;
}

// -- websocket --

function handleIncomingMessage (messageText) {
  console.log('incoming message', messageText);
  let msg = JSON.parse(messageText);
  switch (msg.tag) {
    case 'offer':
      handleOffer(msg)
      break;
  }
}

async function handleOffer (msg) {
  try {
    if (msg.sendVideo) {
      if (rtc.getLocalStreams().length === 0) {
        // fix: need to manipulate rtc.getSenders() to work with firefox
        console.log('sending local stream', localStream);
        rtc.addStream(localStream);
      }
    } else {
      console.log('not sending local stream');
      rtc.removeStream(localStream);
    }
    console.log('setting remote description');
    await rtc.setRemoteDescription(msg.sdp);
    console.log('creating sdp answer');
    let desc = await rtc.createAnswer();
    console.log('got sdp answer, desc');
    await rtc.setLocalDescription(desc);
    console.log('waiting for ice gathering state to complete');
    while (rtc.iceGatheringState !== 'complete') {
      await awaitTimeout(100);
    }
    console.log('ice gathering complete. sending sdp answer');
    webSock.send(
      JSON.stringify({ peerId: localId,
                       tag: 'answer',
                       sdp: rtc.localDescription })
    );
  } catch (e) {
    console.error(e);
  }
}

// -- utility functions --

async function awaitTimeout(ms) {
  return new Promise((resolve) => setTimeout(()=>resolve(),ms));
}
