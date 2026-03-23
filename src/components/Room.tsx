/// <reference types="vite/client" />
import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Check, MonitorUp, MonitorOff, Users, MessageSquare, Send, Circle, Square, ListTodo, Clock, LayoutGrid, PanelRight, Maximize, Settings, Edit2, ShieldAlert, AlertCircle, Hand, X, Pin, PinOff } from "lucide-react";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [userName, setUserName] = useState(location.state?.userName || "Khách");
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(userName);

  const [hasJoined, setHasJoined] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [hostId, setHostId] = useState<string>("");
  const adminPassword = location.state?.adminPassword || "";
  const [roomSettings, setRoomSettings] = useState({ allowScreenShare: true, allowRecord: true, waitingRoom: true });
  const [showSettings, setShowSettings] = useState(false);
  const [participants, setParticipants] = useState<Record<string, { id: string, name: string, isMuted?: boolean, isVideoOff?: boolean }>>({});

  const [peers, setPeers] = useState<{ [key: string]: MediaStream }>({});
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [showUsers, setShowUsers] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showAgenda, setShowAgenda] = useState(false);
  const [agendaText, setAgendaText] = useState("");
  const [meetingDuration, setMeetingDuration] = useState(0);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [layout, setLayout] = useState<'grid' | 'sidebar' | 'spotlight'>('grid');
  const [spotlightId, setSpotlightId] = useState<string>('local');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<string[]>([]);
  const [screenSharingUsers, setScreenSharingUsers] = useState<string[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const [waitingUsers, setWaitingUsers] = useState<{id: string, name: string}[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<{ [key: string]: RTCPeerConnection }>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mixedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const showChatRef = useRef(showChat);
  const seenMessageIds = useRef(new Set<string>());

  useEffect(() => {
    showChatRef.current = showChat;
    if (showChat) {
      setUnreadMessages(0);
    }
  }, [showChat]);

  useEffect(() => {
    const timer = setInterval(() => {
      setMeetingDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, showChat]);

  useEffect(() => {
    if (socketRef.current && hasJoined) {
      socketRef.current.emit("media-state-change", roomId, { isMuted, isVideoOff });
    }
  }, [isMuted, isVideoOff, hasJoined, roomId]);

  useEffect(() => {
    let mounted = true;
    const socketUrl = window.location.origin;
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on("room-info", (info) => {
      if (!mounted) return;
      setIsWaiting(false);
      setHasJoined(true);
      setJoinError("");
      setIsHost(info.hostId === socket.id);
      setHostId(info.hostId);
      setRoomSettings(info.settings);
      const parts: Record<string, any> = {};
      info.users.forEach((u: any) => parts[u.id] = u);
      setParticipants(parts);
      
      if (info.screenSharingUsers && info.screenSharingUsers.length > 0) {
        setScreenSharingUsers(info.screenSharingUsers);
        setLayout('sidebar');
        setSpotlightId(info.screenSharingUsers[0]);
      }
    });

    const createPeerConnection = (userId: string, stream: MediaStream) => {
      const peerConnection = new RTCPeerConnection(ICE_SERVERS);

      // Add local stream tracks to peer connection
      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

      // Handle incoming ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", event.candidate, userId);
        }
      };

      // Handle incoming streams
      peerConnection.ontrack = (event) => {
        if (!mounted) return;
        
        setPeers((prev) => {
          const existingStream = prev[userId];
          if (existingStream) {
            // Add track to existing stream if not already there
            const tracks = existingStream.getTracks();
            if (!tracks.find(t => t.id === event.track.id)) {
              existingStream.addTrack(event.track);
              // Return a new MediaStream object to trigger React re-render
              return { ...prev, [userId]: new MediaStream(existingStream.getTracks()) };
            }
            return prev;
          } else {
            const remoteStream = event.streams[0] || new MediaStream([event.track]);
            return { ...prev, [userId]: remoteStream };
          }
        });
      };

      return peerConnection;
    };

    const initMedia = async () => {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
        } catch (err: any) {
          console.warn("Could not get both video and audio:", err);
          try {
            // Try video only
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            alert("CẢNH BÁO: Không tìm thấy hoặc không có quyền truy cập micro. Chỉ có hình ảnh được sử dụng.");
          } catch (err2: any) {
            try {
              // Try audio only
              stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              alert("CẢNH BÁO: Không tìm thấy hoặc không có quyền truy cập camera. Chỉ có âm thanh được sử dụng.");
            } catch (err3: any) {
              // If both fail, create an empty stream
              stream = new MediaStream();
              alert("CẢNH BÁO: Không tìm thấy camera và micro. Bạn đang tham gia với tư cách người xem.");
            }
          }
        }
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        socket.on("room-error", (msg: string) => {
          setJoinError(msg);
        });

        socket.on("waiting-for-host", () => {
          if (!mounted) return;
          setIsWaiting(true);
        });

        socket.on("guest-waiting", (user: {id: string, name: string}) => {
          if (!mounted) return;
          setWaitingUsers(prev => [...prev, user]);
        });

        socket.on("guest-left-waiting", (userId: string) => {
          if (!mounted) return;
          setWaitingUsers(prev => prev.filter(u => u.id !== userId));
        });

        socket.on("room-rejected", () => {
          if (!mounted) return;
          alert("Bạn đã bị từ chối tham gia phòng này.");
          navigate("/");
        });

        // Handle new user connecting
        socket.on("user-connected", async (userId: string, userData: any) => {
          if (!mounted) return;
          console.log("User connected:", userId);
          setConnectedUsers((prev) => prev.includes(userId) ? prev : [...prev, userId]);
          setParticipants(prev => ({ ...prev, [userId]: userData }));
          
          if (peersRef.current[userId]) {
            peersRef.current[userId].close();
          }

          const peerConnection = createPeerConnection(userId, stream);
          peersRef.current[userId] = peerConnection;

          try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit("offer", offer, userId);
          } catch (err) {
            console.error("Error creating offer:", err);
          }
        });

        socket.on("user-media-state", (userId: string, state: { isMuted?: boolean, isVideoOff?: boolean }) => {
          if (!mounted) return;
          setParticipants(prev => ({
            ...prev,
            [userId]: { ...prev[userId], ...state }
          }));
        });

        // Handle incoming offer
        socket.on("offer", async (offer: RTCSessionDescriptionInit, userId: string) => {
          if (!mounted) return;
          console.log("Received offer from:", userId);
          setConnectedUsers((prev) => prev.includes(userId) ? prev : [...prev, userId]);
          
          if (peersRef.current[userId]) {
            peersRef.current[userId].close();
          }

          const peerConnection = createPeerConnection(userId, stream);
          peersRef.current[userId] = peerConnection;

          try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit("answer", answer, userId);
          } catch (err) {
            console.error("Error handling offer:", err);
          }
        });

        // Handle incoming answer
        socket.on("answer", async (answer: RTCSessionDescriptionInit, userId: string) => {
          if (!mounted) return;
          console.log("Received answer from:", userId);
          const peerConnection = peersRef.current[userId];
          if (peerConnection && peerConnection.signalingState !== "stable") {
            try {
              await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (err) {
              console.error("Error setting remote description:", err);
            }
          }
        });

        // Handle incoming ICE candidate
        socket.on("ice-candidate", async (candidate: RTCIceCandidateInit, userId: string) => {
          if (!mounted) return;
          const peerConnection = peersRef.current[userId];
          if (peerConnection) {
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.error("Error adding ICE candidate:", err);
            }
          }
        });

    socket.on("user-disconnected", (userId: string) => {
      if (!mounted) return;
      console.log("User disconnected:", userId);
      setConnectedUsers((prev) => prev.filter((id) => id !== userId));
      setRaisedHands((prev) => prev.filter((id) => id !== userId));
      setScreenSharingUsers((prev) => prev.filter((id) => id !== userId));
      setParticipants(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      if (peersRef.current[userId]) {
        peersRef.current[userId].close();
        delete peersRef.current[userId];
      }
      setPeers((prev) => {
        const newPeers = { ...prev };
        delete newPeers[userId];
        return newPeers;
      });
    });

    socket.on("user-updated", (userData: any) => {
      if (!mounted) return;
      setParticipants(prev => ({ ...prev, [userData.id]: userData }));
    });

    socket.on("host-changed", (newHostId: string) => {
      if (!mounted) return;
      setIsHost(newHostId === socket.id);
      setHostId(newHostId);
    });

    socket.on("settings-updated", (settings: any) => {
      if (!mounted) return;
      setRoomSettings(settings);
      // If screen sharing is disabled and we are sharing, stop it
      if (!settings.allowScreenShare && isScreenSharing && !isHost) {
        stopScreenShare();
      }
    });

    socket.on("force-muted", () => {
      if (!mounted) return;
      if (localStreamRef.current) {
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack && audioTrack.enabled) {
          audioTrack.enabled = false;
          setIsMuted(true);
        }
      }
    });

    socket.on("force-audio-state", (isMutedState: boolean) => {
      if (!mounted) return;
      if (localStreamRef.current) {
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = !isMutedState;
          setIsMuted(isMutedState);
        }
      }
    });

    socket.on("force-video-state", (isVideoOffState: boolean) => {
      if (!mounted) return;
      if (localStreamRef.current) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = !isVideoOffState;
          setIsVideoOff(isVideoOffState);
        }
      }
    });

      socket.on("chat-message", (message: ChatMessage, senderId: string) => {
        if (!mounted) return;
        if (seenMessageIds.current.has(message.id)) return;
        seenMessageIds.current.add(message.id);

        setMessages((prev) => [...prev, message]);
        
        if (!showChatRef.current) {
          setUnreadMessages((uPrev) => uPrev + 1);
        }
      });

    socket.on("update-agenda", (agenda: string) => {
      if (!mounted) return;
      setAgendaText(agenda);
    });

    socket.on("hand-raised", (userId: string, isRaised: boolean) => {
      if (!mounted) return;
      setRaisedHands((prev) => {
        if (isRaised && !prev.includes(userId)) return [...prev, userId];
        if (!isRaised) return prev.filter((id) => id !== userId);
        return prev;
      });
    });

    socket.on("user-screen-sharing", (userId: string, isSharing: boolean) => {
      if (!mounted) return;
      if (isSharing) {
        setLayout('sidebar');
        setSpotlightId(userId);
        setScreenSharingUsers((prev) => prev.includes(userId) ? prev : [...prev, userId]);
      } else {
        setLayout('grid');
        setSpotlightId('local');
        setScreenSharingUsers((prev) => prev.filter((id) => id !== userId));
      }
    });

    socket.on("room-destroyed", () => {
      if (!mounted) return;
      alert("Chủ phòng đã kết thúc cuộc họp.");
      leaveMeeting();
    });

      } catch (err: any) {
        console.error("Error accessing media devices:", err);
        if (mounted) {
          setError("Không thể truy cập camera hoặc micro: " + err.message);
        }
      }
    };

    initMedia();

    return () => {
      mounted = false;
      // Cleanup
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      mixedAudioTrackRef.current?.stop();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      socket.disconnect();
      Object.values(peersRef.current).forEach((pc: any) => pc.close());
      peersRef.current = {};
    };
  }, [roomId]);

  const saveName = () => {
    if (tempName.trim()) {
      setUserName(tempName.trim());
      setIsEditingName(false);
      if (socketRef.current) {
        socketRef.current.emit("update-name", tempName.trim(), roomId);
      }
    }
  };

  const updateSetting = (key: string, value: boolean) => {
    if (socketRef.current && isHost) {
      socketRef.current.emit("update-settings", { [key]: value }, roomId);
    }
  };

  const forceAudio = (userId: string, isMuted: boolean) => {
    if (socketRef.current && isHost) {
      socketRef.current.emit("force-audio", userId, roomId, isMuted);
    }
  };

  const forceVideo = (userId: string, isVideoOff: boolean) => {
    if (socketRef.current && isHost) {
      socketRef.current.emit("force-video", userId, roomId, isVideoOff);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (mixedAudioTrackRef.current) {
      mixedAudioTrackRef.current.stop();
      mixedAudioTrackRef.current = null;
    }

    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    
    Object.values(peersRef.current).forEach((pc: any) => {
      if (videoTrack) {
        const videoSender = pc.getSenders().find((s: any) => s.track?.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(videoTrack);
        }
      }
      if (audioTrack) {
        const audioSender = pc.getSenders().find((s: any) => s.track?.kind === "audio");
        if (audioSender) {
          audioSender.replaceTrack(audioTrack);
        }
      }
    });

    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }

    setIsScreenSharing(false);
    if (screenSharingUsers.length > 0) {
      setLayout('sidebar');
      setSpotlightId(screenSharingUsers[0]);
    } else {
      setLayout('grid');
      setSpotlightId('local');
    }
    if (socketRef.current) {
      socketRef.current.emit("screen-sharing", false, roomId);
    }
  };

  const toggleScreenShare = async () => {
    if (!isHost && !roomSettings.allowScreenShare) {
      alert("Chủ phòng đã tắt tính năng chia sẻ màn hình.");
      return;
    }
    if (!isScreenSharing) {
      try {
        const startTime = Date.now();
        let screenStream: MediaStream;
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch (err: any) {
          const timeElapsed = Date.now() - startTime;
          if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
            if (timeElapsed < 500) {
              if (window.self !== window.top) {
                alert("LỖI: Tính năng chia sẻ màn hình bị chặn trong chế độ xem trước. Vui lòng mở ứng dụng trong thẻ mới (New Tab) để sử dụng.");
              } else {
                alert("LỖI: Không thể chia sẻ màn hình. Vui lòng kiểm tra quyền ghi màn hình trong cài đặt hệ thống (System Preferences/Settings).");
              }
            } else {
              console.log("Người dùng đã hủy chia sẻ màn hình.");
            }
            return;
          }
          // Fallback to video only if audio is not supported
          try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            alert("CẢNH BÁO: Trình duyệt hoặc hệ điều hành của bạn không hỗ trợ chia sẻ âm thanh hệ thống. Chỉ có hình ảnh được chia sẻ.");
          } catch (fallbackErr: any) {
            if (fallbackErr.name !== 'NotAllowedError') {
               alert("LỖI: Không thể chia sẻ màn hình: " + fallbackErr.message);
            }
            return;
          }
        }

        screenStreamRef.current = screenStream;
        setScreenStream(screenStream);
        const screenTrack = screenStream.getVideoTracks()[0];

        // Handle audio mixing if screen has audio
        const screenAudioTrack = screenStream.getAudioTracks()[0];
        const micAudioTrack = localStreamRef.current?.getAudioTracks()[0];
        
        if (!screenAudioTrack) {
          alert("CẢNH BÁO: Bạn đang chia sẻ màn hình nhưng không có âm thanh. Nếu bạn muốn chia sẻ cả tiếng, hãy đảm bảo bạn đã tích chọn 'Chia sẻ âm thanh' (Share audio) trong hộp thoại của trình duyệt.");
        }

        let audioTrackToSend = micAudioTrack;

        if (screenAudioTrack && micAudioTrack) {
          const audioContext = new AudioContext();
          audioContextRef.current = audioContext;
          
          const dest = audioContext.createMediaStreamDestination();
          
          const micSource = audioContext.createMediaStreamSource(new MediaStream([micAudioTrack]));
          micSource.connect(dest);
          
          const screenSource = audioContext.createMediaStreamSource(new MediaStream([screenAudioTrack]));
          screenSource.connect(dest);
          
          mixedAudioTrackRef.current = dest.stream.getAudioTracks()[0];
          audioTrackToSend = mixedAudioTrackRef.current;
        } else if (screenAudioTrack) {
          audioTrackToSend = screenAudioTrack;
        }

        // Replace track for all peers
        Object.values(peersRef.current).forEach((pc: any) => {
          const videoSender = pc.getSenders().find((s: any) => s.track?.kind === "video");
          if (videoSender) {
            videoSender.replaceTrack(screenTrack);
          }
          
          if (audioTrackToSend) {
            const audioSender = pc.getSenders().find((s: any) => s.track?.kind === "audio");
            if (audioSender) {
              audioSender.replaceTrack(audioTrackToSend);
            }
          }
        });

        // Update local video to show screen
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        setIsScreenSharing(true);
        setLayout('sidebar');
        setSpotlightId('local');
        if (socketRef.current) {
          socketRef.current.emit("screen-sharing", true, roomId);
        }

        // Handle native "Stop sharing" button
        screenTrack.onended = () => {
          stopScreenShare();
        };
      } catch (err: any) {
        console.error("Error sharing screen:", err);
        if (err.name !== 'NotAllowedError') {
          alert("Đã xảy ra lỗi khi chia sẻ màn hình: " + err.message);
        }
      }
    } else {
      stopScreenShare();
    }
  };

  const leaveMeeting = () => {
    // Explicitly stop all media tracks to turn off camera/mic immediately
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    mixedAudioTrackRef.current?.stop();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    
    // Disconnect socket and close peer connections
    socketRef.current?.disconnect();
    Object.values(peersRef.current).forEach((pc: any) => pc.close());
    peersRef.current = {};

    navigate("/");
  };

  const destroyMeeting = () => {
    if (socketRef.current) {
      socketRef.current.emit("destroy-room", roomId);
    }
    leaveMeeting();
  };

  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !socketRef.current) return;

    const message: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      senderId: socketRef.current.id || "local",
      text: newMessage.trim(),
      timestamp: Date.now(),
    };

    seenMessageIds.current.add(message.id);
    socketRef.current.emit("chat-message", message, roomId);
    setMessages((prev) => [...prev, message]);
    setNewMessage("");
  };

  const handleAgendaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!isHost) return;
    const newText = e.target.value;
    setAgendaText(newText);
    if (socketRef.current) {
      socketRef.current.emit("update-agenda", newText, roomId);
    }
  };

  const startRecording = async () => {
    if (!isHost && !roomSettings.allowRecord) {
      alert("Chỉ chủ phòng mới được phép ghi hình.");
      return;
    }
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const options = { mimeType: "video/webm;codecs=vp9,opus" };
      const mediaRecorder = new MediaRecorder(screenStream, options);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: "video/webm",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.style.display = "none";
        a.href = url;
        a.download = `meeting-recording-${new Date().toISOString()}.webm`;
        a.click();
        window.URL.revokeObjectURL(url);
        recordedChunksRef.current = [];
        setIsRecording(false);
        screenStream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);

      // Handle native "Stop sharing" button
      screenStream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };
    } catch (err) {
      console.error("Error starting recording:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const toggleHandRaise = () => {
    const newState = !isHandRaised;
    setIsHandRaised(newState);
    if (socketRef.current) {
      socketRef.current.emit("raise-hand", newState, roomId);
    }
  };

  const handleJoinRoom = () => {
    if (socketRef.current) {
      setJoinError("");
      socketRef.current.emit("join-room", roomId, userName || "Khách", adminPassword);
    }
  };

  const allParticipants = ['local', ...Object.keys(peers)];
  const activeSpotlightId = allParticipants.includes(spotlightId) ? spotlightId : 'local';

  const renderTile = (id: string, className: string) => {
    const isSpotlighted = activeSpotlightId === id && layout !== 'grid';
    const handlePin = () => {
      if (isSpotlighted) {
        setLayout('grid');
      } else {
        setSpotlightId(id);
        if (layout === 'grid') setLayout('spotlight');
      }
    };

    if (id === 'local') {
      return (
        <VideoTile
          key="local"
          stream={isScreenSharing ? screenStream : localStream}
          isLocal
          peerId="local"
          name={userName}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          isScreenSharing={isScreenSharing}
          isHandRaised={isHandRaised}
          className={className}
          onClick={() => setSpotlightId('local')}
          isSpotlighted={isSpotlighted}
          onPin={handlePin}
        />
      );
    }
    return (
      <VideoTile
        key={id}
        stream={peers[id]}
        peerId={id}
        name={participants[id]?.name || "Khách"}
        isMuted={participants[id]?.isMuted}
        isVideoOff={participants[id]?.isVideoOff}
        isHandRaised={raisedHands.includes(id)}
        isScreenSharing={screenSharingUsers.includes(id)}
        className={className}
        onClick={() => setSpotlightId(id)}
        isHost={isHost}
        onToggleAudio={() => forceAudio(id, !participants[id]?.isMuted)}
        onToggleVideo={() => forceVideo(id, !participants[id]?.isVideoOff)}
        isSpotlighted={isSpotlighted}
        onPin={handlePin}
      />
    );
  };

  const cycleLayout = () => {
    if (layout === 'grid') setLayout('sidebar');
    else if (layout === 'sidebar') setLayout('spotlight');
    else setLayout('grid');
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg max-w-md w-full text-center">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-700 mb-6">{error}</p>
          <button
            onClick={() => navigate("/")}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  if (!hasJoined) {
    if (isWaiting) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl max-w-md w-full flex flex-col items-center shadow-2xl text-center">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Đang chờ chủ phòng...</h2>
            <p className="text-gray-600 mb-8">Vui lòng đợi chủ phòng cho phép bạn tham gia cuộc họp này.</p>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors w-full"
            >
              Hủy và quay lại
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl max-w-4xl w-full flex flex-col md:flex-row gap-8 shadow-2xl">
          <div className="flex-1 flex flex-col items-center">
            <div className="relative w-full aspect-video bg-gray-800 rounded-xl overflow-hidden mb-6 shadow-inner">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
              />
              {isVideoOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                  <div className="w-24 h-24 rounded-full bg-blue-600 flex items-center justify-center text-white text-4xl font-medium">
                    {userName.charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
                <button
                  onClick={toggleMute}
                  className={`p-4 rounded-full transition-all shadow-lg ${
                    isMuted ? "bg-red-500 text-white hover:bg-red-600" : "bg-gray-800/80 text-white hover:bg-gray-700 backdrop-blur-sm"
                  }`}
                >
                  {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-4 rounded-full transition-all shadow-lg ${
                    isVideoOff ? "bg-red-500 text-white hover:bg-red-600" : "bg-gray-800/80 text-white hover:bg-gray-700 backdrop-blur-sm"
                  }`}
                >
                  {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                </button>
              </div>
            </div>
          </div>
          
          <div className="flex-1 flex flex-col justify-center">
            <h2 className="text-3xl font-normal text-gray-900 mb-2">Sẵn sàng tham gia?</h2>
            <p className="text-gray-500 mb-8">Phòng: <span className="font-medium text-gray-900">{roomId}</span></p>
            
            {joinError && (
              <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p>{joinError}</p>
              </div>
            )}
            
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-700 mb-2">Tên hiển thị của bạn</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Nhập tên của bạn"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={() => navigate("/")}
                className="flex-1 px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Trở lại
              </button>
              <button
                onClick={handleJoinRoom}
                className="flex-1 px-6 py-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-medium transition-colors shadow-md hover:shadow-lg"
              >
                Tham gia ngay
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col relative overflow-hidden">
      {/* Leave Confirmation Modal */}
      {showLeaveConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl max-w-sm w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Rời khỏi cuộc gọi?</h3>
            <p className="text-gray-600 mb-6">Bạn có chắc chắn muốn rời khỏi cuộc họp này không?</p>
            <div className="flex flex-col gap-3">
              {isHost && (
                <button
                  onClick={destroyMeeting}
                  className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                >
                  Kết thúc cuộc họp cho tất cả
                </button>
              )}
              <div className="flex justify-end gap-3 mt-2">
                <button
                  onClick={() => setShowLeaveConfirm(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={leaveMeeting}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors"
                >
                  Chỉ rời khỏi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Meeting Info Overlay */}
      <div className="absolute top-4 left-4 z-10 bg-gray-800/80 backdrop-blur-sm text-white px-4 py-2 rounded-lg flex items-center gap-4 shadow-lg">
        <div className="flex items-center gap-2 text-sm font-medium border-r border-gray-600 pr-4">
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="font-mono">{formatDuration(meetingDuration)}</span>
        </div>
        <div className="text-sm font-medium">Room: {roomId}</div>
        <button
          onClick={copyLink}
          className="flex items-center gap-1 text-sm bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copied!" : "Copy Link"}
        </button>
      </div>

      {/* Agenda Sidebar/Overlay */}
      {showAgenda && (
        <div className="absolute top-0 right-0 w-80 h-[calc(100%-80px)] bg-gray-800 border-l border-gray-700 z-20 flex flex-col shadow-2xl transition-transform">
          <div className="p-4 border-b border-gray-700 flex justify-between items-center">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <ListTodo className="w-5 h-5" />
              Meeting Agenda
            </h3>
            <button onClick={() => setShowAgenda(false)} className="text-gray-400 hover:text-white text-xl leading-none">
              &times;
            </button>
          </div>
          <div className="flex-1 p-4 flex flex-col">
            <p className="text-xs text-gray-400 mb-2">
              {isHost ? "Chủ phòng đang soạn thảo chương trình họp." : "Chương trình họp từ chủ phòng."}
            </p>
            <textarea
              value={agendaText}
              onChange={handleAgendaChange}
              readOnly={!isHost}
              placeholder={isHost ? "1. Giới thiệu\n2. Cập nhật dự án\n3. Hỏi đáp" : "Chưa có chương trình họp."}
              className={`flex-1 w-full bg-gray-700 text-white rounded-lg p-3 text-sm focus:outline-none resize-none ${isHost ? 'focus:ring-2 focus:ring-blue-500' : 'cursor-default'}`}
            />
          </div>
        </div>
      )}

      {/* Settings Sidebar/Overlay */}
      {showSettings && isHost && (
        <div className="absolute top-0 right-0 w-80 h-[calc(100%-80px)] bg-gray-800 border-l border-gray-700 z-20 flex flex-col shadow-2xl transition-transform">
          <div className="p-4 border-b border-gray-700 flex justify-between items-center">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Cài đặt phòng
            </h3>
            <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white text-xl leading-none">
              &times;
            </button>
          </div>
          <div className="flex-1 p-4 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <span className="text-white text-sm">Cho phép chia sẻ màn hình</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={roomSettings.allowScreenShare} onChange={(e) => updateSetting('allowScreenShare', e.target.checked)} />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white text-sm">Cho phép người khác ghi hình</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={roomSettings.allowRecord} onChange={(e) => updateSetting('allowRecord', e.target.checked)} />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white text-sm">Bật phòng chờ</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={roomSettings.waitingRoom} onChange={(e) => updateSetting('waitingRoom', e.target.checked)} />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Users Sidebar/Overlay */}
      {showUsers && (
        <div className="absolute top-0 right-0 w-80 h-[calc(100%-80px)] bg-gray-800 border-l border-gray-700 z-20 flex flex-col shadow-2xl transition-transform">
          <div className="p-4 border-b border-gray-700 flex justify-between items-center">
            <h3 className="text-white font-semibold">Người tham gia ({connectedUsers.length + 1})</h3>
            <button onClick={() => setShowUsers(false)} className="text-gray-400 hover:text-white text-xl leading-none">
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {isHost && waitingUsers.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-yellow-500 mb-3 uppercase tracking-wider">Phòng chờ ({waitingUsers.length})</h4>
                <div className="space-y-3">
                  {waitingUsers.map(user => (
                    <div key={user.id} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-lg">
                      <div className="flex items-center gap-2 text-white overflow-hidden">
                        <div className="w-8 h-8 bg-yellow-600 rounded-full flex items-center justify-center text-sm font-medium shrink-0">
                          {user.name.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium truncate">{user.name}</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => socketRef.current?.emit("admit-user", user.id, roomId)}
                          className="p-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors"
                          title="Chấp nhận"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => socketRef.current?.emit("reject-user", user.id, roomId)}
                          className="p-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md transition-colors"
                          title="Từ chối"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Trong phòng</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-white">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-medium shrink-0">
                    {userName.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {isEditingName ? (
                      <div className="flex items-center gap-1">
                        <input 
                          type="text" 
                          value={tempName} 
                          onChange={(e) => setTempName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveName()}
                          className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded outline-none"
                          autoFocus
                        />
                        <button onClick={saveName} className="text-green-400 hover:text-green-300"><Check className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{userName} (Bạn)</span>
                        <button onClick={() => setIsEditingName(true)} className="text-gray-400 hover:text-white"><Edit2 className="w-3 h-3" /></button>
                      </div>
                    )}
                    {isHost && <span className="text-xs text-blue-400">Chủ phòng</span>}
                  </div>
                </div>
                {connectedUsers.map(userId => {
                  const p = participants[userId];
                  const pName = p?.name || "Khách";
                  return (
                    <div key={userId} className="flex items-center gap-3 text-white">
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-sm font-medium shrink-0">
                        {pName.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 flex flex-col overflow-hidden">
                        <span className="text-sm font-medium truncate">{pName}</span>
                        {hostId === userId && <span className="text-xs text-blue-400">Chủ phòng</span>}
                      </div>
                      {isHost && (
                        <div className="flex gap-1">
                          <button 
                            onClick={() => forceAudio(userId, !p?.isMuted)} 
                            className={`p-1 rounded transition-colors ${p?.isMuted ? 'text-red-400 hover:text-red-300' : 'text-gray-400 hover:text-white'}`} 
                            title={p?.isMuted ? "Bật mic người này" : "Tắt mic người này"}
                          >
                            {p?.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                          </button>
                          <button 
                            onClick={() => forceVideo(userId, !p?.isVideoOff)} 
                            className={`p-1 rounded transition-colors ${p?.isVideoOff ? 'text-red-400 hover:text-red-300' : 'text-gray-400 hover:text-white'}`} 
                            title={p?.isVideoOff ? "Bật camera người này" : "Tắt camera người này"}
                          >
                            {p?.isVideoOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Sidebar/Overlay */}
      {showChat && (
        <div className="absolute top-0 right-0 w-80 h-[calc(100%-80px)] bg-gray-800 border-l border-gray-700 z-20 flex flex-col shadow-2xl transition-transform">
          <div className="p-4 border-b border-gray-700 flex justify-between items-center">
            <h3 className="text-white font-semibold">In-call messages</h3>
            <button onClick={() => setShowChat(false)} className="text-gray-400 hover:text-white text-xl leading-none">
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => {
              const isLocal = msg.senderId === socketRef.current?.id || msg.senderId === "local";
              return (
                <div key={msg.id} className={`flex flex-col ${isLocal ? "items-end" : "items-start"}`}>
                  <div className="text-xs text-gray-400 mb-1">
                    {isLocal ? "Bạn" : participants[msg.senderId]?.name || `User ${msg.senderId.substring(0, 4)}`} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className={`px-3 py-2 rounded-lg max-w-[85%] break-words ${isLocal ? "bg-blue-600 text-white rounded-tr-none" : "bg-gray-700 text-white rounded-tl-none"}`}>
                    {msg.text}
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendMessage} className="p-4 border-t border-gray-700 flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Send a message..."
              className="flex-1 bg-gray-700 text-white rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      )}

      {/* Video Area */}
      <div className="flex-1 p-4 flex items-center justify-center overflow-hidden">
        {layout === 'grid' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full h-full max-h-[calc(100vh-100px)]">
            {allParticipants.map(id => renderTile(id, "w-full h-full aspect-video"))}
          </div>
        )}

        {layout === 'sidebar' && (
          <div className="flex flex-col md:flex-row gap-4 w-full h-full max-h-[calc(100vh-100px)]">
            <div className="flex-1 h-full min-h-[50vh]">
              {renderTile(activeSpotlightId, "w-full h-full")}
            </div>
            <div className="flex md:flex-col gap-4 overflow-auto md:w-64 shrink-0 h-32 md:h-full">
              {allParticipants.filter(id => id !== activeSpotlightId).map(id => 
                renderTile(id, "w-48 md:w-full h-full md:h-40 shrink-0")
              )}
            </div>
          </div>
        )}

        {layout === 'spotlight' && (
          <div className="flex flex-col gap-4 w-full h-full max-h-[calc(100vh-100px)]">
            <div className="flex-1 w-full h-full min-h-[50vh]">
              {renderTile(activeSpotlightId, "w-full h-full")}
            </div>
            <div className="flex gap-4 overflow-x-auto h-32 shrink-0 justify-center">
              {allParticipants.filter(id => id !== activeSpotlightId).map(id => 
                renderTile(id, "w-48 h-full shrink-0")
              )}
            </div>
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-start sm:justify-center gap-4 px-4 z-10 overflow-x-auto no-scrollbar shrink-0">
        <button
          onClick={cycleLayout}
          className="p-4 rounded-full bg-gray-700 hover:bg-gray-600 text-white transition-colors shadow-lg shrink-0"
          title="Change Layout"
        >
          {layout === 'grid' && <LayoutGrid className="w-6 h-6" />}
          {layout === 'sidebar' && <PanelRight className="w-6 h-6" />}
          {layout === 'spotlight' && <Maximize className="w-6 h-6" />}
        </button>

        <button
          onClick={toggleMute}
          className={`p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            isMuted ? "bg-red-500 hover:bg-red-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
          title={isMuted ? "Turn on microphone" : "Turn off microphone"}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        
        <button
          onClick={toggleVideo}
          className={`p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            isVideoOff ? "bg-red-500 hover:bg-red-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
          title={isVideoOff ? "Turn on camera" : "Turn off camera"}
        >
          {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>

        <button
          onClick={toggleScreenShare}
          className={`p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            isScreenSharing ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          {isScreenSharing ? <MonitorOff className="w-6 h-6" /> : <MonitorUp className="w-6 h-6" />}
        </button>

        <button
          onClick={toggleHandRaise}
          className={`p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            isHandRaised ? "bg-yellow-500 hover:bg-yellow-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
          title={isHandRaised ? "Hạ tay xuống" : "Giơ tay phát biểu"}
        >
          <Hand className="w-6 h-6" />
        </button>

        <button
          onClick={() => {
            setShowUsers(!showUsers);
            if (!showUsers) {
              setShowChat(false);
              setShowAgenda(false);
              setShowSettings(false);
            }
          }}
          className={`relative p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            showUsers ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
          title="Người tham gia"
        >
          <Users className="w-6 h-6" />
          <span className="absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-gray-900">
            {connectedUsers.length + 1}
          </span>
          {isHost && waitingUsers.length > 0 && (
            <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-gray-900">
              {waitingUsers.length}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setShowChat(!showChat);
            if (!showChat) {
              setUnreadMessages(0);
              setShowUsers(false);
              setShowAgenda(false);
              setShowSettings(false);
            }
          }}
          className={`relative p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            showChat ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
          title="Chat"
        >
          <MessageSquare className="w-6 h-6" />
          {unreadMessages > 0 && (
            <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-gray-900">
              {unreadMessages}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setShowAgenda(!showAgenda);
            if (!showAgenda) {
              setShowUsers(false);
              setShowChat(false);
              setShowSettings(false);
            }
          }}
          className={`p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            showAgenda ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
          }`}
          title="Meeting Agenda"
        >
          <ListTodo className="w-6 h-6" />
        </button>

        {isHost && (
          <button
            onClick={() => {
              setShowSettings(!showSettings);
              if (!showSettings) {
                setShowUsers(false);
                setShowChat(false);
                setShowAgenda(false);
              }
            }}
            className={`p-4 rounded-full transition-colors shadow-lg shrink-0 ${
              showSettings ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"
            }`}
            title="Cài đặt phòng"
          >
            <Settings className="w-6 h-6" />
          </button>
        )}

        <button
          onClick={toggleRecording}
          disabled={!isHost && !roomSettings.allowRecord}
          className={`p-4 rounded-full transition-colors shadow-lg shrink-0 ${
            isRecording ? "bg-red-500 hover:bg-red-600 text-white animate-pulse" : "bg-gray-700 hover:bg-gray-600 text-white"
          } ${(!isHost && !roomSettings.allowRecord) ? "opacity-50 cursor-not-allowed" : ""}`}
          title={isRecording ? "Dừng ghi hình" : "Ghi hình"}
        >
          {isRecording ? <Square className="w-6 h-6" /> : <Circle className="w-6 h-6 text-red-500" />}
        </button>
        
        <button
          onClick={() => setShowLeaveConfirm(true)}
          className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors shadow-lg sm:ml-4 shrink-0"
          title="Leave call"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}

// Helper component for videos
function VideoTile({
  stream,
  isLocal,
  peerId,
  name,
  isMuted,
  isVideoOff,
  isScreenSharing,
  isHandRaised,
  className,
  onClick,
  isHost,
  onToggleAudio,
  onToggleVideo,
  isSpotlighted,
  onPin
}: {
  stream: MediaStream | null;
  isLocal?: boolean;
  peerId?: string;
  name?: string;
  isMuted?: boolean;
  isVideoOff?: boolean;
  isScreenSharing?: boolean;
  isHandRaised?: boolean;
  className?: string;
  onClick?: () => void;
  isHost?: boolean;
  onToggleAudio?: () => void;
  onToggleVideo?: () => void;
  isSpotlighted?: boolean;
  onPin?: () => void;
  key?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      
      // Safari/iOS fix: explicitly call play()
      const playVideo = async () => {
        try {
          if (videoRef.current) {
            await videoRef.current.play();
          }
        } catch (err) {
          console.warn("Video play failed:", err);
        }
      };
      
      // Only try to play if not hidden
      if (!isVideoOff || isScreenSharing) {
        playVideo();
      }
    }
  }, [stream, isVideoOff, isScreenSharing]);

  return (
    <div onClick={onClick} className={`relative bg-gray-800 rounded-xl overflow-hidden shadow-xl flex items-center justify-center cursor-pointer transition-all duration-300 ring-2 ring-transparent hover:ring-blue-500/50 group ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full ${isScreenSharing ? 'object-contain bg-black' : 'object-cover'} ${isVideoOff && !isScreenSharing ? 'hidden' : ''}`}
        style={{ transform: isLocal && !isScreenSharing ? "scaleX(-1)" : "none" }}
      />
      {isVideoOff && !isScreenSharing && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-medium">
            {name ? name.substring(0, 2).toUpperCase() : (isLocal ? "Bạn" : peerId?.substring(0, 2).toUpperCase())}
          </div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 bg-black/50 px-2 py-1 rounded text-white text-sm backdrop-blur-sm flex items-center gap-2">
        {name || (isLocal ? "Bạn" : `User ${peerId?.substring(0, 4)}`)} {isLocal && isMuted && "(Muted)"}
      </div>
      {isHandRaised && (
        <div className="absolute top-4 left-4 bg-yellow-500/80 text-white p-2 rounded-full backdrop-blur-sm shadow-lg animate-bounce">
          <Hand className="w-5 h-5" />
        </div>
      )}
      <div className={`absolute top-4 right-4 flex gap-2 transition-opacity ${isSpotlighted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {onPin && (
          <button 
            onClick={(e) => { e.stopPropagation(); onPin(); }}
            className={`p-2 rounded-full backdrop-blur-sm text-white transition-colors ${isSpotlighted ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-700/80 hover:bg-gray-600'}`}
            title={isSpotlighted ? "Bỏ ghim" : "Ghim lên màn hình chính"}
          >
            {isSpotlighted ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
        )}
        {isHost && !isLocal && (
          <>
            {onToggleAudio && (
              <button 
                onClick={(e) => { e.stopPropagation(); onToggleAudio(); }}
                className={`p-2 rounded-full backdrop-blur-sm text-white transition-colors ${isMuted ? 'bg-red-500/80 hover:bg-red-600' : 'bg-gray-700/80 hover:bg-gray-600'}`}
                title={isMuted ? "Bật mic người này" : "Tắt mic người này"}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
            {onToggleVideo && (
              <button 
                onClick={(e) => { e.stopPropagation(); onToggleVideo(); }}
                className={`p-2 rounded-full backdrop-blur-sm text-white transition-colors ${isVideoOff ? 'bg-red-500/80 hover:bg-red-600' : 'bg-gray-700/80 hover:bg-gray-600'}`}
                title={isVideoOff ? "Bật camera người này" : "Tắt camera người này"}
              >
                {isVideoOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
