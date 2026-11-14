import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  CheckCircle,
  Plus,
  Sparkles,
  Flame,
  AlertCircle,
  BookOpen,
  ArrowRight,
  Filter,
  Layers,
  ChevronLeft,
  ChevronRight,
  Check
} from 'lucide-react';
import { Course, StudyPlannerSession, StudyPlannerTask } from '../../types';
import { api } from '../../services/api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Dialog } from '../ui/Dialog';
import { NavTab } from '../layout/Sidebar';

const toLocalDateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const getMondayOfCurrentWeek = (date: Date) => {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return monday;
};

interface StudyPlannerProps {
  courses: Course[];
  onNavigate: (tab: NavTab, params?: { courseId?: string; topicQuery?: string }) => void;
}

export const StudyPlanner: React.FC<StudyPlannerProps> = ({ courses, onNavigate }) => {
  const [sessions, setSessions] = useState<StudyPlannerSession[]>([]);
  const [tasks, setTasks] = useState<StudyPlannerTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = useState<'calendar' | 'agenda'>('calendar');
  const [selectedCourseFilter, setSelectedCourseFilter] = useState<string>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // New session form state
  const [newTitle, setNewTitle] = useState('');
  const [newCourseId, setNewCourseId] = useState(courses[0]?.id || 'course_cs201');
  const [newDate, setNewDate] = useState(toLocalDateString(new Date()));
  const [newTime, setNewTime] = useState('14:00');
  const [newDuration, setNewDuration] = useState(60);
  const [newType, setNewType] = useState<StudyPlannerSession['type']>('review');
  const [newNotes, setNewNotes] = useState('');

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [sessData, tasksData] = await Promise.all([
          api.getPlannerSessions(),
          api.getStudyTasks()
        ]);
        setSessions(sessData);
        setTasks(tasksData);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Unable to load planner data.');
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const handleToggleSession = async (id: string) => {
    try {
      setErrorMessage(null);
      const updated = await api.togglePlannerSession(id);
      setSessions(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to update the study session.');
    }
  };

  const handleToggleTask = async (id: string) => {
    try {
      setErrorMessage(null);
      const updated = await api.toggleStudyTask(id);
      setTasks(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to update the study task.');
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const course = courses.find(c => c.id === newCourseId);
    try {
      setErrorMessage(null);
      const added = await api.addPlannerSession({
      courseId: newCourseId,
      courseCode: course?.code || 'CS 201',
      title: newTitle,
      date: newDate,
      startTime: newTime,
      durationMinutes: newDuration,
      completed: false,
      notes: newNotes,
      type: newType
      });

      setSessions([added, ...sessions]);
      setShowAddModal(false);
      setNewTitle('');
      setNewNotes('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to schedule the study session.');
    }
  };

  const filteredSessions = sessions.filter(s => {
    if (selectedCourseFilter !== 'all' && s.courseId !== selectedCourseFilter) return false;
    return true;
  });

  const completedCount = sessions.filter(s => s.completed).length;
  const totalPlannedMinutes = sessions.reduce((acc, s) => acc + s.durationMinutes, 0);
  const completedMinutes = sessions.filter(s => s.completed).reduce((acc, s) => acc + s.durationMinutes, 0);
  const completedSessionDates = new Set(sessions.filter((session) => session.completed).map((session) => session.date));
  const streakAnchor = new Date();
  if (!completedSessionDates.has(toLocalDateString(streakAnchor))) {
    streakAnchor.setDate(streakAnchor.getDate() - 1);
  }
  let studyStreak = 0;
  while (completedSessionDates.has(toLocalDateString(streakAnchor))) {
    studyStreak += 1;
    streakAnchor.setDate(streakAnchor.getDate() - 1);
  }
  const nextExam = tasks
    .filter((task) => task.type === 'exam' && !task.completed)
    .map((task) => ({ task, date: new Date(`${task.dueDate}T00:00:00`) }))
    .filter(({ date }) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.date.getTime() - right.date.getTime())[0];
  const daysUntilExam = nextExam
    ? Math.ceil((nextExam.date.getTime() - new Date(toLocalDateString(new Date())).getTime()) / (24 * 60 * 60 * 1000))
    : null;

  // Generate 7-day strip for calendar
  const today = new Date();
  const weekStart = getMondayOfCurrentWeek(today);
  const currentWeekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return {
      dateStr: toLocalDateString(d),
      dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNumber: d.getDate(),
      isToday: d.toDateString() === today.toDateString()
    };
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="indigo">Academic Calendar & Planner</Badge>
            <span className="text-xs text-[#64748B]">Personalized Study Scheduling</span>
          </div>
          <h1 className="text-xl font-bold text-[#0F172A] mt-1 tracking-tight">
            Study Planner & Goal Tracking
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            disabled
            icon={<Sparkles className="w-3.5 h-3.5 text-[#4338CA]" />}
          >
            AI optimization unavailable
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddModal(true)}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Schedule Study Block
          </Button>
        </div>
      </div>

      {errorMessage && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{errorMessage}</p>}

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-200 text-[#B45309] flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[#64748B] block font-medium">Study Streak</span>
            <span className="text-lg font-bold text-[#0F172A] tabular-nums">{studyStreak} {studyStreak === 1 ? 'Day' : 'Days'} Active</span>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200 text-[#4338CA] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[#64748B] block font-medium">Weekly Target</span>
            <span className="text-lg font-bold text-[#0F172A] tabular-nums">
              {(completedMinutes / 60).toFixed(1)} / {(totalPlannedMinutes / 60).toFixed(1)} hrs
            </span>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-50 border border-green-200 text-[#15803D] flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[#64748B] block font-medium">Blocks Completed</span>
            <span className="text-lg font-bold text-[#0F172A] tabular-nums">
              {completedCount} of {sessions.length} sessions
            </span>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 text-[#475569] flex items-center justify-center shrink-0">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[#64748B] block font-medium">Next Major Exam</span>
            <span className="text-lg font-bold text-[#0F172A]">
              {nextExam && daysUntilExam !== null
                ? `${nextExam.task.courseCode} ${daysUntilExam < 0 ? 'overdue' : daysUntilExam === 0 ? 'today' : `in ${daysUntilExam} days`}`
                : 'No exam scheduled'}
            </span>
          </div>
        </Card>
      </div>

      {/* View & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="bg-slate-200/70 p-1 rounded-lg flex items-center text-xs font-semibold">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'calendar' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B]'
              }`}
            >
              Weekly Calendar
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'agenda' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B]'
              }`}
            >
              Agenda & Deadlines
            </button>
          </div>

          <select
            value={selectedCourseFilter}
            onChange={(e) => setSelectedCourseFilter(e.target.value)}
            className="text-xs bg-white border border-[#E2E8F0] rounded-lg px-2.5 py-1.5 font-medium text-[#0F172A] outline-none"
          >
            <option value="all">All Enrolled Courses</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-[#64748B]">
          Displaying week of <strong className="text-[#0F172A]">
            {new Date(`${currentWeekDays[0].dateStr}T00:00:00`).toLocaleDateString()} – {new Date(`${currentWeekDays[6].dateStr}T00:00:00`).toLocaleDateString()}
          </strong>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'calendar' ? (
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-xs overflow-hidden">
          {/* Day Headers */}
          <div className="grid grid-cols-7 border-b border-[#E2E8F0] bg-slate-50/50 text-center">
            {currentWeekDays.map(day => (
              <div
                key={day.dateStr}
                className={`py-3 px-2 border-r last:border-r-0 border-[#E2E8F0] ${
                  day.isToday ? 'bg-indigo-50/40' : ''
                }`}
              >
                <span className="text-[11px] font-semibold text-[#64748B] block uppercase tracking-wider">
                  {day.dayName}
                </span>
                <span
                  className={`inline-flex items-center justify-center w-7 h-7 text-xs font-bold rounded-full mt-1 ${
                    day.isToday ? 'bg-[#4338CA] text-white shadow-xs' : 'text-[#0F172A]'
                  }`}
                >
                  {day.dayNumber}
                </span>
              </div>
            ))}
          </div>

          {/* Day Columns */}
          <div className="grid grid-cols-7 min-h-[380px] divide-x divide-[#E2E8F0]">
            {currentWeekDays.map(day => {
              const daySessions = filteredSessions.filter(s => s.date === day.dateStr);

              return (
                <div
                  key={`col_${day.dateStr}`}
                  className={`p-2 space-y-2 flex flex-col ${
                    day.isToday ? 'bg-indigo-50/10' : ''
                  }`}
                >
                  {daySessions.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[11px] text-[#94A3B8] italic p-2 text-center">
                      No blocks scheduled
                    </div>
                  ) : (
                    daySessions.map(session => (
                      <div
                        key={session.id}
                        onClick={() => handleToggleSession(session.id)}
                        className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer group ${
                          session.completed
                            ? 'bg-slate-50 border-slate-200 opacity-60'
                            : session.courseCode === 'CS 201'
                            ? 'bg-indigo-50/80 border-indigo-200 hover:border-indigo-400'
                            : session.courseCode === 'CS 305'
                            ? 'bg-teal-50/80 border-teal-200 hover:border-teal-400'
                            : 'bg-amber-50/80 border-amber-200 hover:border-amber-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#4338CA]">
                            {session.courseCode}
                          </span>
                          <span className="text-[10px] text-[#64748B] tabular-nums">
                            {session.startTime}
                          </span>
                        </div>

                        <p
                          className={`text-xs font-semibold mt-1 leading-snug ${
                            session.completed ? 'line-through text-[#64748B]' : 'text-[#0F172A]'
                          }`}
                        >
                          {session.title}
                        </p>

                        <div className="flex items-center justify-between mt-2 pt-1 border-t border-black/5 text-[10px] text-[#64748B]">
                          <span>{session.durationMinutes} min</span>
                          <span className="flex items-center gap-1 font-medium text-[#4338CA]">
                            {session.completed ? (
                              <Check className="w-3 h-3 text-[#15803D]" />
                            ) : (
                              'Mark Done'
                            )}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Agenda View */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider">
              Scheduled Study Blocks ({filteredSessions.length})
            </h3>
            {filteredSessions.map(session => (
              <Card key={session.id} className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => handleToggleSession(session.id)}
                    className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                      session.completed
                        ? 'bg-[#15803D] border-[#15803D] text-white'
                        : 'border-[#CBD5E1] bg-white hover:border-[#4338CA]'
                    }`}
                  >
                    {session.completed && <Check className="w-3.5 h-3.5" />}
                  </button>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#4338CA]">{session.courseCode}</span>
                      <span className="text-xs text-[#64748B]">·</span>
                      <span className="text-xs text-[#64748B] tabular-nums">
                        {session.date} at {session.startTime} ({session.durationMinutes} min)
                      </span>
                    </div>
                    <h4
                      className={`text-sm font-semibold ${
                        session.completed ? 'line-through text-[#64748B]' : 'text-[#0F172A]'
                      }`}
                    >
                      {session.title}
                    </h4>
                    {session.notes && (
                      <p className="text-xs text-[#64748B] mt-1">{session.notes}</p>
                    )}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onNavigate('tutor', {
                      courseId: session.courseId,
                      topicQuery: `Help me prepare for ${session.title}`
                    })
                  }
                  icon={<Sparkles className="w-3 h-3 text-[#4338CA]" />}
                >
                  AI Prep
                </Button>
              </Card>
            ))}
          </div>

          {/* Academic Deadlines Column */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider">
              Upcoming Deadlines & Quizzes ({tasks.length})
            </h3>
            <div className="space-y-2.5">
              {tasks.map(task => (
                <Card key={task.id} className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant={task.priority === 'high' ? 'red' : 'indigo'}>
                      {task.type.toUpperCase()}
                    </Badge>
                    <span className="text-xs font-medium text-[#64748B]">{task.dueDate}</span>
                  </div>
                  <h4 className="text-xs font-semibold text-[#0F172A]">{task.title}</h4>
                  <div className="flex items-center justify-between text-xs text-[#64748B] pt-1">
                    <span>{task.courseCode}</span>
                    <button
                      onClick={() => handleToggleTask(task.id)}
                      className={`text-[11px] font-semibold cursor-pointer ${
                        task.completed ? 'text-[#15803D]' : 'text-[#4338CA] hover:underline'
                      }`}
                    >
                      {task.completed ? 'Completed' : 'Mark Completed'}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Study Block Modal */}
      <Dialog
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Schedule Academic Study Block"
        description="Plan a focused study session or syllabus topic review."
      >
        <form onSubmit={handleCreateSession} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[#0F172A]">Topic / Session Title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Master AVL Rotations or Midterm Exam Review"
              required
              className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0F172A]">Course</label>
              <select
                value={newCourseId}
                onChange={(e) => setNewCourseId(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
              >
                {courses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0F172A]">Session Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as any)}
                className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
              >
                <option value="review">Topic Review</option>
                <option value="quiz_prep">Quiz / Exam Prep</option>
                <option value="assignment">Assignment Coding</option>
                <option value="lecture">Lecture Reading</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0F172A]">Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0F172A]">Start Time</label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0F172A]">Duration (min)</label>
              <input
                type="number"
                min="15"
                max="240"
                step="15"
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-[#0F172A]">Study Notes & Objectives</label>
            <textarea
              rows={2}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="e.g. Focus on edge cases and code implementations"
              className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit">
              Save Study Block
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
