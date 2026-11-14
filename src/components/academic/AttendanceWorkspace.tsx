import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarCheck, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Course } from '../../types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface AttendanceWorkspaceProps { courses: Course[]; }

export const AttendanceWorkspace: React.FC<AttendanceWorkspaceProps> = ({ courses }) => {
  const { role } = useAuth();
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.getAttendanceSummary>>>([]);
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [courseId, setCourseId] = useState(courses[0]?.id || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sessionTitle, setSessionTitle] = useState('Lecture');
  const [sessionId, setSessionId] = useState('');
  const [roster, setRoster] = useState<Array<{ student_id: string; profiles?: { id: string; email: string } }>>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attendanceBranches, setAttendanceBranches] = useState<Awaited<ReturnType<typeof api.getAttendanceBranches>>>([]);
  const [filterBranchId, setFilterBranchId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.getAttendanceReport>>>([]);

  const load = async () => {
    setError('');
    try {
      if (role === 'admin') {
        const [branches, nextReport] = await Promise.all([
          api.getAttendanceBranches(),
          api.getAttendanceReport({
            branchId: filterBranchId || undefined,
            from: filterFrom || undefined,
            to: filterTo || undefined,
          }),
        ]);
        setAttendanceBranches(branches);
        setReport(nextReport);
        setSummary([]);
        setSessions([]);
        return;
      }
      const [nextSummary, nextSessions] = await Promise.all([
        api.getAttendanceSummary({ from: filterFrom || undefined, to: filterTo || undefined }),
        api.getAttendance(),
      ]);
      setSummary(nextSummary);
      setSessions(nextSessions);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Attendance could not be loaded.'); }
  };
  useEffect(() => { void load(); }, [role, filterBranchId, filterFrom, filterTo]);

  const createSession = async () => {
    if (!courseId) return;
    try {
      const created = await api.createAttendanceSession(courseId, date, sessionTitle);
      setSessionId(String(created.id || ''));
      setMessage('Attendance session created. Load the enrolled roster to mark attendance.');
      const nextRoster = await api.getAttendanceRoster(courseId);
      setRoster(nextRoster);
      setStatuses(Object.fromEntries(nextRoster.map((student) => [student.student_id, 'present'])));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Session could not be created.'); }
  };
  const save = async () => {
    if (!sessionId) return;
    try {
      await api.saveAttendance(sessionId, Object.entries(statuses).map(([studentId, status]) => ({ studentId, status })));
      setMessage('Attendance saved successfully.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Attendance could not be saved.'); }
  };

  const classReports = attendanceBranches
    .filter((branch) => !filterBranchId || branch.id === filterBranchId)
    .map((branch) => {
      const rows = report.filter((item) => item.branchId === branch.id);
      const totals = rows.reduce((total, item) => ({
        total: total.total + item.total,
        present: total.present + item.present,
        absent: total.absent + item.absent,
        late: total.late + item.late,
        excused: total.excused + item.excused,
      }), { total: 0, present: 0, absent: 0, late: 0, excused: 0 });
      return {
        ...branch,
        ...totals,
        percentage: totals.total ? Math.round(((totals.present + totals.late + totals.excused) / totals.total) * 100) : 0,
      };
    });

  if (role === 'student') {
    return <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-5">
      <header><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Student attendance</p><h1 className="mt-1 text-xl font-bold text-slate-900">Your attendance</h1></header>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!summary.length ? <Card className="p-6 text-sm text-slate-600">No attendance has been recorded yet.</Card> : <div className="grid gap-4 md:grid-cols-3">{summary.map((item) => {
        const course = courses.find((candidate) => candidate.id === item.courseId);
        return <Card key={item.courseId} className="p-5"><h2 className="font-semibold text-slate-900">{course?.code || item.courseId}</h2><p className="mt-2 text-3xl font-bold text-indigo-700">{item.percentage}%</p><p className="mt-1 text-xs text-slate-500">{item.present} present · {item.absent} absent · {item.total} sessions</p></Card>;
      })}</div>}
      <Card className="p-5"><h2 className="mb-3 font-semibold text-slate-900">Session history</h2>{!sessions.length ? <p className="text-sm text-slate-600">No attendance sessions recorded.</p> : <div className="space-y-2">{sessions.map((record) => {
        const session = record.attendance_sessions as Record<string, unknown> | undefined;
        const course = courses.find((candidate) => candidate.id === String(session?.course_id || ''));
        return <div key={String(record.id)} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm"><span>{course?.code || String(session?.course_id || '')} · {String(session?.title || 'Session')} · {String(session?.session_date || '')}</span><strong className="capitalize">{String(record.status || '')}</strong></div>;
      })}</div>}</Card>
    </div>;
  }

  return <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{role === 'admin' ? 'Administrator reports' : 'Faculty workspace'}</p><h1 className="mt-1 text-xl font-bold text-slate-900">{role === 'admin' ? 'Class attendance reports' : 'Attendance management'}</h1></header>
    {error && <div role="alert" className="flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} />{error}</div>}
    {message && <div role="status" className="flex gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700"><CheckCircle2 size={16} />{message}</div>}
    {role === 'admin' && <Card className="p-5"><h2 className="mb-3 font-semibold text-slate-900">Class attendance report</h2><div className="grid gap-3 md:grid-cols-4"><select aria-label="Filter by branch" value={filterBranchId} onChange={(event) => setFilterBranchId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All branches</option>{attendanceBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.departmentCode ? `${branch.departmentCode} · ` : ''}{branch.code} · {branch.name}</option>)}</select><input aria-label="From date" type="date" value={filterFrom} onChange={(event) => setFilterFrom(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input aria-label="To date" type="date" value={filterTo} onChange={(event) => setFilterTo(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><Button type="button" variant="outline" onClick={() => { setFilterBranchId(''); setFilterFrom(''); setFilterTo(''); }}>Clear filters</Button></div></Card>}
    {role === 'instructor' && <Card className="p-5 space-y-4">
      <h2 className="font-semibold text-slate-900">Create lecture session</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} maxLength={200} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <Button type="button" onClick={createSession} icon={<CalendarCheck size={15} />}>Create and load roster</Button>
      </div>
      {roster.length > 0 && <div className="space-y-2"><h3 className="text-sm font-semibold">Enrolled students</h3>{roster.map((student) => <div key={student.student_id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm"><span>{student.profiles?.email || student.student_id}</span><select value={statuses[student.student_id] || 'present'} onChange={(event) => setStatuses((current) => ({ ...current, [student.student_id]: event.target.value }))} className="rounded border border-slate-300 px-2 py-1"><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select></div>)}<Button type="button" onClick={save}>Save attendance</Button></div>}
    </Card>}
    {role === 'instructor' && <Card className="p-5"><h2 className="mb-3 font-semibold text-slate-900">Session history</h2>{!sessions.length ? <p className="text-sm text-slate-600">No attendance sessions recorded.</p> : <div className="space-y-2">{sessions.map((session) => <div key={String(session.id)} className="flex justify-between border-b border-slate-100 py-2 text-sm"><span>{String(session.title)} · {String(session.session_date)}</span><span className="text-slate-500">{String(session.course_id)}</span></div>)}</div>}</Card>}
    {role === 'admin' && <Card className="space-y-4 p-5"><h2 className="font-semibold text-slate-900">Branch summaries</h2>{!classReports.length ? <p className="text-sm text-slate-600">No branches are available for this institution.</p> : <div className="grid gap-3 md:grid-cols-2">{classReports.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 p-4"><h3 className="font-medium text-slate-900">{item.departmentCode ? `${item.departmentCode} · ` : ''}{item.code} · {item.name}</h3><p className="mt-2 text-2xl font-bold text-indigo-700">{item.percentage}%</p><p className="mt-1 text-xs text-slate-600">{item.present} present · {item.absent} absent · {item.late} late · {item.excused} excused · {item.total} records</p></div>)}</div>}</Card>}
    {role === 'admin' && filterBranchId && <Card className="p-5"><h2 className="mb-3 font-semibold text-slate-900">Selected class report</h2>{!report.length ? <p className="text-sm text-slate-600">No attendance records match this class and date range.</p> : <div className="space-y-2">{report.map((item) => <div key={`${item.courseId}-${item.studentId}`} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm"><span>Student · {item.studentId}</span><span>{item.percentage}% · {item.present} present · {item.absent} absent · {item.late} late · {item.excused} excused</span></div>)}</div>}</Card>}
  </div>;
};
