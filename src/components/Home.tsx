import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Video, Keyboard, User, Lock } from "lucide-react";
import { v4 as uuidV4 } from "uuid";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword })
      });
      if (res.ok) {
        setIsAdmin(true);
        setShowAdminLogin(false);
      } else {
        setLoginError("Sai mật khẩu!");
      }
    } catch (err) {
      console.error(err);
      setLoginError("Lỗi kết nối đến máy chủ.");
    }
  };

  const createNewMeeting = () => {
    if (!isAdmin) {
      setShowAdminLogin(true);
      return;
    }
    const newRoomId = uuidV4();
    navigate(`/${newRoomId}`, { state: { userName: userName || "Chủ phòng", adminPassword } });
  };

  const joinMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      let id = roomId.trim();
      try {
        if (id.startsWith('http')) {
          const url = new URL(id);
          id = url.pathname.split('/').filter(Boolean).pop() || id;
        } else if (id.includes('/')) {
          id = id.split('/').filter(Boolean).pop() || id;
        }
      } catch (err) {
        // Ignore parsing errors and use the raw input
      }
      navigate(`/${id}`, { state: { userName: userName || "Khách" } });
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Video className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-medium text-gray-600">Tiếng Anh Cô Hà</span>
        </div>
        <div>
          {isAdmin ? (
            <button
              onClick={() => {
                setIsAdmin(false);
                setAdminPassword("");
              }}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-red-600 transition-colors px-3 py-2 rounded-md hover:bg-red-50"
            >
              <Lock className="w-4 h-4" />
              Đăng xuất
            </button>
          ) : (
            <button
              onClick={() => setShowAdminLogin(true)}
              className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors px-3 py-2 rounded-md hover:bg-blue-50"
            >
              <Lock className="w-4 h-4" />
              Đăng nhập
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-12 max-w-6xl mx-auto w-full">
        <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-normal text-gray-900 mb-4">
            Phòng học. <br />
          </h1>
          <p className="text-gray-600 text-lg mb-8 max-w-xl">
            Chào mừng các em đến lớp học tiếng anh cô Hà.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full max-w-md mb-4">
            <div className="relative flex-1 w-full">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Nhập tên của bạn (tùy chọn)"
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full max-w-md">
            {isAdmin && (
              <button
                onClick={createNewMeeting}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-md font-medium transition-colors w-full sm:w-auto"
              >
                <Video className="w-5 h-5" />
                Mở lớp mới
              </button>
            )}
            
            <form onSubmit={joinMeeting} className="relative flex-1 w-full">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Keyboard className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Nhập mã lớp hoặc link"
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </form>
            
            <button
              onClick={joinMeeting}
              disabled={!roomId.trim()}
              className={`font-medium px-4 py-3 rounded-md transition-colors ${
                roomId.trim() ? "text-blue-600 hover:bg-blue-50" : "text-gray-400 cursor-not-allowed"
              }`}
            >
              Tham gia
            </button>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-200 w-full max-w-md">
            <p className="text-sm text-gray-600">
              <a href="#" className="text-blue-600 hover:underline">Giới thiệu</a> Tiếng Anh Cô Hà @2026.
            </p>
          </div>
        </div>
        
        <div className="flex-1 hidden md:flex justify-center">
          <img 
            src="https://www.gstatic.com/meet/user_edu_get_a_link_light_90698cd7b4ca04d3005c962a3756c42d.svg" 
            alt="Google Meet illustration" 
            className="max-w-md w-full"
          />
        </div>
      </main>

      {/* Admin Login Modal */}
      {showAdminLogin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-sm">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-5 h-5 text-blue-600" />
              <h2 className="text-xl font-semibold">Đăng nhập Admin</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">Chỉ admin mới có quyền tạo phòng mới.</p>
            {loginError && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-200">
                {loginError}
              </div>
            )}
            <form onSubmit={handleAdminLogin}>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Nhập mật khẩu admin"
                className="w-full px-3 py-2 border border-gray-300 rounded-md mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdminLogin(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={!adminPassword}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Xác nhận
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
