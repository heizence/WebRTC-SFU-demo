import { Device } from "mediasoup-client";
import io from "socket.io-client";

console.log("Client loaded");

const socket = io();

let device;
let currentRoomId = null;
let currentPeerId = null;
let rtpCapabilities = null;
const peers = new Map();

// mediasoup
let sendTransport = null;
let recvTransport = null;
const producers = new Map();
const consumers = new Map();

// DOM 요소
const statusEl = document.getElementById("status");
const nicknameInput = document.getElementById("nickname");
const roomIdInput = document.getElementById("roomIdInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const startMediaBtn = document.getElementById("startMediaBtn");
const roomInfoEl = document.getElementById("roomInfo");
const currentRoomIdEl = document.getElementById("currentRoomId");
const currentPeerIdEl = document.getElementById("currentPeerId");
const peerCountEl = document.getElementById("peerCount");
const peersListEl = document.getElementById("peers");
const localVideoEl = document.getElementById("localVideo");
const remoteVideosEl = document.getElementById("remoteVideos");

// 닉네임 기본값 설정
nicknameInput.value = `User_${Math.floor(Math.random() * 1000)}`;

// Socket.io 연결 이벤트
socket.on("connect", () => {
  console.log("Connected to server");
  updateStatus("서버 연결됨", "connected");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  updateStatus("서버 연결 끊김", "error");
  resetRoomState();
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error);
  updateStatus("연결 오류", "error");
});

// 방 생성
createRoomBtn.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    alert("닉네임을 입력하세요");
    return;
  }

  socket.emit("create-room", (response) => {
    if (response.success) {
      console.log("Room created:", response.roomId);
      rtpCapabilities = response.rtpCapabilities;
      joinRoom(response.roomId, nickname);
    } else {
      console.error("Failed to create room:", response.error);
      alert("방 생성 실패: " + response.error);
    }
  });
});

// 방 입장
joinRoomBtn.addEventListener("click", () => {
  const roomId = roomIdInput.value.trim();
  const nickname = nicknameInput.value.trim();

  if (!roomId) {
    alert("방 ID를 입력하세요");
    return;
  }

  if (!nickname) {
    alert("닉네임을 입력하세요");
    return;
  }

  joinRoom(roomId, nickname);
});

async function joinRoom(roomId, nickname) {
  socket.emit("join-room", { roomId, nickname }, async (response) => {
    if (response.success) {
      console.log("Joined room:", roomId);
      currentRoomId = roomId;
      currentPeerId = response.peerId;
      rtpCapabilities = response.rtpCapabilities;

      response.peers.forEach((peer) => {
        peers.set(peer.peerId, { nickname: peer.nickname });
      });

      await initDevice();

      updateRoomUI();
      updateStatus(`방 "${roomId}"에 입장`, "connected");
      startMediaBtn.disabled = false;
    } else {
      console.error("Failed to join room:", response.error);
      alert("방 입장 실패: " + response.error);
    }
  });
}

// mediasoup Device 초기화
async function initDevice() {
  try {
    device = new Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    console.log("Device loaded", device.rtpCapabilities);
  } catch (error) {
    console.error("Failed to load device:", error);
    alert("디바이스 초기화 실패: " + error.message);
  }
}

// 미디어 시작
startMediaBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    localVideoEl.srcObject = stream;
    console.log("Got local media:", stream.getTracks());

    await createSendTransport();

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (videoTrack) {
      await produce(videoTrack, "video");
    }
    if (audioTrack) {
      await produce(audioTrack, "audio");
    }

    await createRecvTransport();

    startMediaBtn.disabled = true;
    updateStatus("미디어 전송 중", "connected");
  } catch (error) {
    console.error("Failed to start media:", error);
    alert("미디어 시작 실패: " + error.message);
  }
});

// Send Transport 생성
async function createSendTransport() {
  return new Promise((resolve, reject) => {
    socket.emit(
      "create-transport",
      { roomId: currentRoomId, direction: "send" },
      async (response) => {
        if (!response.success) {
          reject(new Error(response.error));
          return;
        }

        sendTransport = device.createSendTransport(response.params);

        sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
          try {
            socket.emit(
              "connect-transport",
              {
                roomId: currentRoomId,
                transportId: sendTransport.id,
                dtlsParameters,
              },
              (res) => {
                if (res.success) {
                  callback();
                } else {
                  errback(new Error(res.error));
                }
              },
            );
          } catch (error) {
            errback(error);
          }
        });

        sendTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
          try {
            socket.emit(
              "produce",
              {
                roomId: currentRoomId,
                transportId: sendTransport.id,
                kind,
                rtpParameters,
              },
              (res) => {
                if (res.success) {
                  callback({ id: res.id });
                } else {
                  errback(new Error(res.error));
                }
              },
            );
          } catch (error) {
            errback(error);
          }
        });

        console.log("Send transport created");
        resolve();
      },
    );
  });
}

// Receive Transport 생성
async function createRecvTransport() {
  return new Promise((resolve, reject) => {
    socket.emit(
      "create-transport",
      { roomId: currentRoomId, direction: "recv" },
      async (response) => {
        if (!response.success) {
          reject(new Error(response.error));
          return;
        }

        recvTransport = device.createRecvTransport(response.params);

        recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
          try {
            socket.emit(
              "connect-transport",
              {
                roomId: currentRoomId,
                transportId: recvTransport.id,
                dtlsParameters,
              },
              (res) => {
                if (res.success) {
                  callback();
                } else {
                  errback(new Error(res.error));
                }
              },
            );
          } catch (error) {
            errback(error);
          }
        });

        console.log("Recv transport created");
        resolve();
      },
    );
  });
}

// Produce (송신)
async function produce(track, kind) {
  const producer = await sendTransport.produce({ track });
  producers.set(kind, producer);
  console.log(`Producer created [${kind}]:`, producer.id);
}

// Consume (수신)
async function consume(peerId, producerId, kind) {
  if (!recvTransport) {
    console.warn("Recv transport not ready");
    return;
  }

  socket.emit(
    "consume",
    {
      roomId: currentRoomId,
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    },
    async (response) => {
      if (!response.success) {
        console.error("Failed to consume:", response.error);
        return;
      }

      const { params } = response;
      const consumer = await recvTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      consumers.set(consumer.id, consumer);
      console.log(`Consumer created [${kind}]:`, consumer.id);

      socket.emit(
        "resume-consumer",
        {
          roomId: currentRoomId,
          consumerId: consumer.id,
        },
        (res) => {
          if (res.success) {
            console.log("Consumer resumed");
          }
        },
      );

      addRemoteVideo(peerId, kind, consumer.track);
    },
  );
}

// 원격 비디오 추가
function addRemoteVideo(peerId, kind, track) {
  let videoContainer = document.getElementById(`remote-${peerId}`);

  if (!videoContainer) {
    videoContainer = document.createElement("div");
    videoContainer.id = `remote-${peerId}`;
    videoContainer.className = "remote-video";

    const peerInfo = peers.get(peerId);
    const heading = document.createElement("h4");
    heading.textContent = peerInfo ? peerInfo.nickname : peerId;

    const video = document.createElement("video");
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = new MediaStream();

    videoContainer.appendChild(heading);
    videoContainer.appendChild(video);
    remoteVideosEl.appendChild(videoContainer);
  }

  const video = document.getElementById(`video-${peerId}`);
  video.srcObject.addTrack(track);
}

// 방 나가기
leaveRoomBtn.addEventListener("click", () => {
  if (currentRoomId) {
    socket.emit("leave-room", { roomId: currentRoomId });

    if (localVideoEl.srcObject) {
      localVideoEl.srcObject.getTracks().forEach((track) => track.stop());
      localVideoEl.srcObject = null;
    }

    resetRoomState();
    updateStatus("방에서 나왔습니다", "connected");
  }
});

// 새 peer 입장
socket.on("peer-joined", ({ peerId, nickname }) => {
  console.log("Peer joined:", peerId, nickname);
  peers.set(peerId, { nickname });
  updateRoomUI();
});

// 새 Producer 알림
socket.on("new-producer", ({ peerId, producerId, kind }) => {
  console.log("New producer:", peerId, producerId, kind);

  if (recvTransport) {
    consume(peerId, producerId, kind);
  }
});

// Peer 퇴장
socket.on("peer-left", ({ peerId }) => {
  console.log("Peer left:", peerId);
  peers.delete(peerId);

  const videoContainer = document.getElementById(`remote-${peerId}`);
  if (videoContainer) {
    videoContainer.remove();
  }

  updateRoomUI();
});

// UI 업데이트
function updateStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status " + type;
}

function updateRoomUI() {
  if (currentRoomId) {
    roomInfoEl.style.display = "block";
    currentRoomIdEl.textContent = currentRoomId;
    currentPeerIdEl.textContent = currentPeerId;
    peerCountEl.textContent = peers.size + 1;

    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;
    roomIdInput.disabled = true;
    nicknameInput.disabled = true;
    leaveRoomBtn.disabled = false;

    peersListEl.innerHTML = "";

    const myLi = document.createElement("li");
    myLi.textContent = `${nicknameInput.value} (나)`;
    myLi.style.fontWeight = "bold";
    peersListEl.appendChild(myLi);

    peers.forEach((peer, peerId) => {
      const li = document.createElement("li");
      li.textContent = peer.nickname;
      li.dataset.peerId = peerId;
      peersListEl.appendChild(li);
    });
  }
}

function resetRoomState() {
  currentRoomId = null;
  currentPeerId = null;
  rtpCapabilities = null;
  peers.clear();

  if (sendTransport) {
    sendTransport.close();
    sendTransport = null;
  }
  if (recvTransport) {
    recvTransport.close();
    recvTransport = null;
  }
  producers.clear();
  consumers.clear();

  roomInfoEl.style.display = "none";
  createRoomBtn.disabled = false;
  joinRoomBtn.disabled = false;
  roomIdInput.disabled = false;
  nicknameInput.disabled = false;
  leaveRoomBtn.disabled = true;
  startMediaBtn.disabled = true;

  peersListEl.innerHTML = "";
  remoteVideosEl.innerHTML = "";
}
