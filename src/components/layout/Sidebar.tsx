import React from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  GitFork,
  Inbox,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export type NavTab =
  | 'dashboard'
  | 'courses'
  | 'tutor'
  | 'materials'
  | 'assessments'
  // Retained for old links; these tabs redirect to their parent modules.
  | 'assignment-agent'
  | 'learning-agent'
  | 'analytics'
  | 'learning-path'
  | 'planner'
  | 'attendance'
  | 'projects'
  | 'lab'
  | 'instructor'
  | 'admin'
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  isMobileOpen: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  onOpenSettings,
  onOpenNotifications,
  isMobileOpen,
}) => {
  const { user, role, switchRole, signOut } = useAuth();
  const studentItems = [
    { id: 'dashboard' as NavTab, label: 'Overview', icon: LayoutDashboard },
    { id: 'assessments' as NavTab, label: 'Assignment', icon: CheckSquare },
    { id: 'analytics' as NavTab, label: 'Reports', icon: BarChart3 },
    { id: 'tutor' as NavTab, label: 'AI Tutor', icon: Bot },
    { id: 'courses' as NavTab, label: 'My Courses', icon: BookOpen },
    { id: 'learning-path' as NavTab, label: 'Learning Path', icon: GitFork },
    { id: 'planner' as NavTab, label: 'Study Planner', icon: CalendarDays },
    { id: 'attendance' as NavTab, label: 'Attendance', icon: CalendarDays },
    { id: 'projects' as NavTab, label: 'Projects & Research', icon: GitFork },
    { id: 'lab' as NavTab, label: 'Coding Lab', icon: Code2 },
  ];
  const facultyItems = [
    { id: 'instructor' as NavTab, label: 'Overview', icon: LayoutDashboard },
    { id: 'courses' as NavTab, label: 'Courses', icon: BookOpen },
    { id: 'materials' as NavTab, label: 'File Storage', icon: FileText },
    { id: 'analytics' as NavTab, label: 'Reports', icon: BarChart3 },
    { id: 'attendance' as NavTab, label: 'Attendance', icon: CalendarDays },
    { id: 'projects' as NavTab, label: 'Projects & Research', icon: GitFork },
    { id: 'tutor' as NavTab, label: 'AI Tutor', icon: Bot },
  ];
  const adminItems = [
    { id: 'admin' as NavTab, label: 'Course Management', icon: BookOpen },
    { id: 'attendance' as NavTab, label: 'Attendance Reports', icon: CalendarDays },
    { id: 'projects' as NavTab, label: 'Projects & Research', icon: GitFork },
  ];
  const items = role === 'admin' ? adminItems : role === 'instructor' ? facultyItems : studentItems;

  return (
    <aside className={`app-sidebar ${isMobileOpen ? 'is-mobile-open' : ''} ${isCollapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="brand-lockup"
        onClick={() => onSelectTab(role === 'admin' ? 'admin' : role === 'instructor' ? 'instructor' : 'dashboard')}
        aria-label="LearnPulse home"
      >
        <span className="brand-mark"><Sparkles size={17} strokeWidth={2.2} aria-hidden="true" /></span>
        {!isCollapsed && <span className="brand-name"><strong>LEARN</strong>PULSE</span>}
      </button>

      <button
        type="button"
        className="sidebar-collapse"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {items.map(({ id, label, icon: Icon }) => {
          const active = currentTab === id;
          return (
            <button
              type="button"
              key={id}
              onClick={() => onSelectTab(id)}
              className={`sidebar-link ${active ? 'is-active' : ''}`}
              title={isCollapsed ? label : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              {!isCollapsed && <span>{label}</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenNotifications}
          className="sidebar-link"
          title={isCollapsed ? 'Inbox' : undefined}
        >
          <Inbox size={16} aria-hidden="true" />
          {!isCollapsed && <span>Inbox</span>}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className={`sidebar-link ${currentTab === 'settings' ? 'is-active' : ''}`}
          title={isCollapsed ? 'Settings' : undefined}
          aria-current={currentTab === 'settings' ? 'page' : undefined}
        >
          <Settings size={16} aria-hidden="true" />
          {!isCollapsed && <span>Settings</span>}
        </button>
      </nav>

      {!isCollapsed && role === 'student' && (
        <button type="button" className="sidebar-promo" onClick={() => onSelectTab('learning-path')}>
          <strong>Keep learning!</strong>
          <span>Explore your personalized learning path.</span>
          <span className="promo-action">View learning path <ChevronRight size={12} /></span>
          <span className="promo-art" aria-hidden="true"><GraduationCapIcon /></span>
        </button>
      )}

      <div className="sidebar-footer">
        {!isCollapsed && role !== 'admin' && (
          <button
            type="button"
            className="sidebar-role"
            onClick={() => switchRole(role === 'student' ? 'instructor' : 'student')}
            aria-label={`Switch to ${role === 'student' ? 'faculty' : 'student'} portal`}
          >
            {role === 'student' ? 'Student portal' : 'Faculty portal'}
          </button>
        )}
        <button type="button" className="sidebar-logout" onClick={signOut} title="Log out">
          <LogOut size={16} aria-hidden="true" />
          {!isCollapsed && <span>Log Out</span>}
        </button>
        {!isCollapsed && (
          <div className="sidebar-identity">
            <span className="sidebar-avatar">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user.name || 'S').charAt(0).toUpperCase()}
            </span>
            <span className="sidebar-user-copy"><strong>{user.name || 'Student'}</strong><small>{user.department || user.role}</small></span>
          </div>
        )}
      </div>
    </aside>
  );
};

const GraduationCapIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="m5 18 19-9 19 9-19 9-19-9Z" fill="currentColor" opacity=".8" />
    <path d="M13 22v10c6 5 16 5 22 0V22l-11 5-11-5Z" fill="currentColor" />
    <path d="M42 19v13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
