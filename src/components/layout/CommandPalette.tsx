import React, { useState, useEffect } from 'react';
import {
  Search,
  BookOpen,
  Bot,
  FileText,
  CheckSquare,
  BarChart3,
  GitFork,
  ArrowRight,
  X
} from 'lucide-react';
import { NavTab } from './Sidebar';
import { Course, Assessment, UserRole } from '../../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab, params?: { courseId?: string; assessmentId?: string }) => void;
  courses: Course[];
  assessments: Assessment[];
  role: UserRole;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  courses,
  assessments,
  role
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const defaultActions = [
    { id: 'nav_dash', title: 'Open Overview Dashboard', subtitle: 'View progress, weak topics, and weekly activity', tab: 'dashboard' as NavTab, icon: BarChart3 },
    { id: 'nav_tutor', title: 'Ask AI Academic Tutor', subtitle: 'Ask questions when an AI provider is configured', tab: 'tutor' as NavTab, icon: Bot },
    { id: 'nav_path', title: 'View Personalized Learning Path', subtitle: 'Recommended sequence of prerequisite concepts', tab: 'learning-path' as NavTab, icon: GitFork },
    { id: 'nav_planner', title: 'Open Study Planner & Calendar', subtitle: 'Weekly study schedule, goal hours, and exams', tab: 'planner' as NavTab, icon: CheckSquare },
    { id: 'nav_lab', title: 'Practice in Coding Lab', subtitle: 'Algorithmic sandbox challenges with unit tests', tab: 'lab' as NavTab, icon: BookOpen },
    ...(role === 'instructor'
      ? [{ id: 'nav_materials', title: 'Upload or View Study Materials', subtitle: 'Manage course files; document processing is not configured', tab: 'materials' as NavTab, icon: FileText }]
      : [])
  ];

  const filteredCourses = courses.filter(c =>
    c.title.toLowerCase().includes(query.toLowerCase()) ||
    c.code.toLowerCase().includes(query.toLowerCase())
  );

  const filteredAssessments = assessments.filter(a =>
    a.title.toLowerCase().includes(query.toLowerCase()) ||
    a.courseCode.toLowerCase().includes(query.toLowerCase()) ||
    a.topic.toLowerCase().includes(query.toLowerCase())
  );

  const filteredActions = defaultActions.filter(a =>
    a.title.toLowerCase().includes(query.toLowerCase()) ||
    a.subtitle.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-[#E2E8F0] overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-[#E2E8F0] gap-3">
          <Search className="w-4 h-4 text-[#64748B] shrink-0" />
          <input
            type="text"
            placeholder="Type a course, topic, quiz, or command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="flex-1 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none bg-transparent"
          />
          <button
            onClick={onClose}
            className="p-1 text-[#94A3B8] hover:text-[#0F172A] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-4">
          {/* Quick Actions */}
          {filteredActions.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">
                Platform Navigation
              </p>
              {filteredActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    onClick={() => {
                      onNavigate(action.tab);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 rounded-lg group transition-colors"
                  >
                    <Icon className="w-4 h-4 text-[#4338CA] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#0F172A]">{action.title}</p>
                      <p className="text-[11px] text-[#64748B] truncate">{action.subtitle}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[#CBD5E1] group-hover:text-[#4338CA] transition-colors" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Courses */}
          {filteredCourses.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">
                Courses
              </p>
              {filteredCourses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onNavigate('courses', { courseId: c.id });
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 rounded-lg group transition-colors"
                >
                  <BookOpen className="w-4 h-4 text-[#64748B] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A]">
                      {c.code} · {c.title}
                    </p>
                    <p className="text-[11px] text-[#64748B]">{c.progress}% completed</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-[#CBD5E1] group-hover:text-[#4338CA] transition-colors" />
                </button>
              ))}
            </div>
          )}

          {/* Assessments */}
          {filteredAssessments.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">
                Assessments & Diagnostic Quizzes
              </p>
              {filteredAssessments.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    onNavigate('assessments', { assessmentId: a.id });
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 rounded-lg group transition-colors"
                >
                  <CheckSquare className="w-4 h-4 text-[#64748B] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A]">
                      {a.courseCode} · {a.title}
                    </p>
                    <p className="text-[11px] text-[#64748B]">
                      {a.questionCount} Questions · {a.durationMinutes} min
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-[#CBD5E1] group-hover:text-[#4338CA] transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 border-t border-[#E2E8F0] bg-slate-50 text-[11px] text-[#64748B] flex items-center justify-between">
          <span>Press ESC to close</span>
          <span>Student Agent AI · Express API</span>
        </div>
      </div>
    </div>
  );
};
