import React, { useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  ChevronRight,
  Command,
  Menu,
  Pencil,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useApiStatus } from '../../context/ApiStatusContext';
import { Course } from '../../types';
import { NavTab } from './Sidebar';

interface HeaderProps {
  pageTitle: string;
  isDashboard: boolean;
  courses: Course[];
  onNavigate: (tab: NavTab, params?: { courseId?: string }) => void;
  onOpenCommandPalette: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onToggleMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  pageTitle,
  isDashboard,
  courses,
  onNavigate,
  onOpenCommandPalette,
  onOpenNotifications,
  onOpenSettings,
  onToggleMobileMenu,
}) => {
  const { user } = useAuth();
  const { isLive, latencyMs, isChecking, reconnect, healthData } = useApiStatus();
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? courses.filter((course) => `${course.code} ${course.title}`.toLocaleLowerCase().includes(needle)).slice(0, 5)
      : [];
  }, [courses, query]);
  const greeting = new Date().getHours() < 12
    ? 'Hello'
    : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const openCourse = (courseId: string) => {
    onNavigate('courses', { courseId });
    setQuery('');
    setIsSearchOpen(false);
  };

  return (
    <header className={`app-header ${isDashboard ? 'is-dashboard-header' : ''}`}>
      <div className="header-primary">
        <button type="button" className="mobile-menu-button" onClick={onToggleMobileMenu} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <div className="header-intro">
          {isDashboard ? (
            <>
              <h1>{greeting} {user.name?.split(/\s+/)[0] || 'there'}!</h1>
              <p>Let&apos;s learn something new today!</p>
            </>
          ) : (
            <>
              <h1>{pageTitle}</h1>
              <p>Welcome back, {user.name || 'student'}</p>
            </>
          )}
        </div>

        <div className="header-actions">
          <div className={`course-search ${isSearchOpen ? 'is-open' : ''}`}>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Search from courses..."
              aria-label="Search courses"
              aria-expanded={isSearchOpen && query.length > 0}
              onFocus={() => setIsSearchOpen(true)}
              onBlur={() => setIsSearchOpen(false)}
              onChange={(event) => {
                setQuery(event.target.value);
                setIsSearchOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  setIsSearchOpen(false);
                  event.currentTarget.blur();
                }
                if (event.key === 'Enter' && matches[0]) openCourse(matches[0].id);
              }}
            />
            {query ? (
              <button type="button" aria-label="Clear course search" onClick={() => setQuery('')}><X size={14} /></button>
            ) : (
              <button type="button" aria-label="Open full search" title="Search courses and more" onClick={onOpenCommandPalette}>
                <Command size={13} />
              </button>
            )}
            {isSearchOpen && query && (
              <div className="course-search-results">
                {matches.length ? matches.map((course) => (
                  <button type="button" key={course.id} onMouseDown={(event) => event.preventDefault()} onClick={() => openCourse(course.id)}>
                    <span><strong>{course.code}</strong><small>{course.title}</small></span><ChevronRight size={15} />
                  </button>
                )) : <p>No matching courses found.</p>}
              </div>
            )}
          </div>

          <button type="button" className="header-icon-button notification-button" onClick={onOpenNotifications} aria-label="Notifications">
            <Bell size={17} />
          </button>
          <button type="button" className="header-status" onClick={onOpenSettings} title="Open API connection settings">
            <Activity size={14} className={isLive ? 'status-connected' : 'status-offline'} aria-hidden="true" />
            <span className={`status-dot ${isLive ? 'is-connected' : ''}`} />
            <span className="status-label">{isChecking ? 'Checking' : isLive ? `${latencyMs} ms` : isDemoMode || healthData?.demo_mode ? 'Demo' : 'Offline'}</span>
          </button>
          <button
            type="button"
            className="header-reconnect"
            onClick={reconnect}
            disabled={isChecking}
            aria-label={isChecking ? 'Checking backend connection' : 'Reconnect to backend'}
            title={isChecking ? 'Checking connection' : 'Reconnect to backend'}
          >
            <RotateCw size={13} className={isChecking ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="header-profile">
        <strong>Profile</strong>
        <button type="button" onClick={onOpenSettings} aria-label="Edit profile and settings"><Pencil size={14} /></button>
      </div>

    </header>
  );
};
