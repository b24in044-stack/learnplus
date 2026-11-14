import React, { useEffect, useState } from 'react';
import { X, Sparkles, Bell } from 'lucide-react';
import { NavTab } from './Sidebar';
import { api } from '../../services/api';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose
}) => {
  const [announcements, setAnnouncements] = useState<Awaited<ReturnType<typeof api.getAnnouncements>>>([]);
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof api.getNotifications>>>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isOpen) return;
    setError('');
    void Promise.allSettled([api.getNotifications(), api.getAnnouncements()]).then((results) => {
      const [notificationResult, announcementResult] = results;
      if (notificationResult.status === 'fulfilled') setNotifications(notificationResult.value);
      if (announcementResult.status === 'fulfilled') setAnnouncements(announcementResult.value);
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        setError(failure.reason instanceof Error ? failure.reason.message : 'Notifications could not be loaded.');
      }
    });
  }, [isOpen]);
  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((current) => current.map((item) => ({ ...item, read_at: new Date().toISOString() })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Notifications could not be updated.');
    }
  };
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs">
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col border-l border-[#E2E8F0]">
        <div className="flex items-center justify-between p-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#4338CA]" />
            <h2 className="text-sm font-semibold text-[#0F172A]">Notifications & Alerts</h2>
          </div>
          <div className="flex items-center gap-2">
            {notifications.some((item) => !item.read_at) && (
              <button type="button" onClick={() => void markAllRead()} className="text-[11px] font-semibold text-[#4338CA]">
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="p-1 text-[#64748B] hover:text-[#0F172A] rounded-md">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">{error}</p>}
          {!error && notifications.length === 0 && announcements.length === 0 && <p className="rounded-lg border border-[#E2E8F0] bg-slate-50 p-4 text-xs text-[#64748B]">No notifications are available.</p>}
          <div className="space-y-3">
            {notifications.map((notification) => (
              <button
                type="button"
                key={notification.id}
                onClick={() => {
                  if (!notification.read_at) void api.markNotificationRead(notification.id);
                  setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
                }}
                className={`block w-full rounded-lg border p-3 text-left ${notification.read_at ? 'border-[#E2E8F0]' : 'border-indigo-200 bg-indigo-50/50'}`}
              >
                <div className="flex items-start gap-2">
                  <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#4338CA]" />
                  <div>
                    <h3 className="text-xs font-semibold text-[#0F172A]">{notification.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-[#64748B]">{notification.body}</p>
                  </div>
                </div>
              </button>
            ))}
            {announcements.map((announcement) => (
              <article key={announcement.id} className="rounded-lg border border-[#E2E8F0] p-3">
                <div className="flex items-start gap-2">
                  <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#4338CA]" />
                  <div>
                    <h3 className="text-xs font-semibold text-[#0F172A]">{announcement.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-[#64748B]">{announcement.content}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-[#E2E8F0] bg-slate-50 text-center">
          <p className="text-[11px] text-[#64748B]">Showing authorized course announcements</p>
        </div>
      </div>
    </div>
  );
};
