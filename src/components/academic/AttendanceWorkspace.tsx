import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarCheck,
  CheckCircle2,
  Download,
  FileUp,
  Save,
  Search,
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Course } from '../../types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface AttendanceWorkspaceProps { courses: Course[]; }
type AttendanceStatus = '' | 'present' | 'absent' | 'late' | 'excused';
type RosterStudent = {
  student_id: string;
  studentCode: string;
  studentName: string;
  email: string;
};
type AttendancePreview = Awaited<ReturnType<typeof api.previewAttendanceUpload>>;

const statusLabels: Record<Exclude<AttendanceStatus, ''>, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
};

const escapeCsv = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const AttendanceWorkspace: React.FC<AttendanceWorkspaceProps> = ({ courses }) => {
  const { role } = useAuth();
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.getAttendanceSummary>>>([]);
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [courseId, setCourseId] = useState(courses[0]?.id || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sessionTitle, setSessionTitle] = useState('Lecture');
  const [sessionId, setSessionId] = useState('');
  const [historyCourseId, setHistoryCourseId] = useState('');
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [originalStatuses, setOriginalStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [correctionReason, setCorrectionReason] = useState('');
  const [corrections, setCorrections] = useState<Array<Record<string, unknown>>>([]);
  const [preview, setPreview] = useState<AttendancePreview | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attendanceBranches, setAttendanceBranches] = useState<Awaited<ReturnType<typeof api.getAttendanceBranches>>>([]);
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof api.getAttendanceActivity>>>([]);
  const [filterBranchId, setFilterBranchId] = useState('');
  const [filterSemesterId, setFilterSemesterId] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.getAttendanceReport>>>([]);

  const load = async () => {
    setError('');
    try {
      if (role === 'admin') {
        const [branches, nextReport, nextActivity] = await Promise.all([
          api.getAttendanceBranches(),
          api.getAttendanceReport({
            branchId: filterBranchId || undefined,
            semesterId: filterSemesterId || undefined,
            courseId: filterCourseId || undefined,
            from: filterFrom || undefined,
            to: filterTo || undefined,
          }),
          api.getAttendanceActivity({
            branchId: filterBranchId || undefined,
            semesterId: filterSemesterId || undefined,
            courseId: filterCourseId || undefined,
            from: filterFrom || undefined,
            to: filterTo || undefined,
          }),
        ]);
        setAttendanceBranches(branches);
        setReport(nextReport);
        setActivity(nextActivity);
        setSummary([]);
        setSessions([]);
        return;
      }
      if (role === 'student') {
        const [nextSummary, nextSessions] = await Promise.all([
          api.getAttendanceSummary({ from: filterFrom || undefined, to: filterTo || undefined }),
          api.getAttendance(),
        ]);
        setSummary(nextSummary);
        setSessions(nextSessions);
        return;
      }
      setSessions(await api.getAttendance());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Attendance could not be loaded.');
    }
  };

  useEffect(() => { void load(); }, [role, filterBranchId, filterSemesterId, filterCourseId, filterFrom, filterTo]);
  useEffect(() => {
    if (!courseId && courses[0]?.id) setCourseId(courses[0].id);
  }, [courseId, courses]);

  const visibleRoster = useMemo(() => {
    const query = search.trim().toLowerCase();
    return roster.filter((student) => !query
      || student.studentName.toLowerCase().includes(query)
      || student.studentCode.toLowerCase().includes(query)
      || student.email.toLowerCase().includes(query));
  }, [roster, search]);
  const statusCounts = useMemo(() => roster.reduce((counts, student) => {
    const status = statuses[student.student_id];
    if (status) counts[status] += 1;
    else counts.unmarked += 1;
    return counts;
  }, { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 }), [roster, statuses]);

  const loadRoster = async () => {
    if (!courseId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const nextRoster = await api.getAttendanceRoster(courseId);
      setRoster(nextRoster);
      setStatuses(Object.fromEntries(nextRoster.map((student) => [student.student_id, ''])));
      setOriginalStatuses({});
      setSessionId('');
      setCorrections([]);
      setCorrectionReason('');
      setPreview(null);
      setMessage(`${nextRoster.length} enrolled students loaded. Select a status for each student or preview an upload.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The course roster could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const previewUpload = async (file?: File) => {
    if (!file || !courseId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.previewAttendanceUpload(courseId, file);
      setPreview(result);
      setStatuses((current) => {
        const next = { ...current };
        result.validRecords.forEach(({ studentId, status }) => {
          next[studentId] = status as AttendanceStatus;
        });
        return next;
      });
      setMessage(`Preview ready: ${result.validCount} valid rows, ${result.invalidCount} rows need review.`);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : 'The attendance file could not be previewed.');
    } finally {
      setBusy(false);
    }
  };

  const openSession = async (session: Record<string, unknown>) => {
    const id = String(session.id || '');
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const details = await api.getAttendanceSession(id);
      const nextCourseId = String(details.session.course_id || '');
      const saved = new Map(details.records.map((record) => [record.student_id, record.status as AttendanceStatus]));
      const nextRoster = details.records.map((record) => ({
        student_id: record.student_id,
        studentCode: record.studentCode || '',
        studentName: record.studentName || '',
        email: record.email || '',
      }));
      const savedStatuses = Object.fromEntries(details.records.map((record) => [
        record.student_id,
        record.status as AttendanceStatus,
      ]));
      setCourseId(nextCourseId);
      setDate(String(details.session.session_date || ''));
      setSessionTitle(String(details.session.title || 'Lecture'));
      setSessionId(id);
      setRoster(nextRoster);
      setStatuses(Object.fromEntries(nextRoster.map((student) => [student.student_id, saved.get(student.student_id) || ''])));
      setOriginalStatuses(savedStatuses);
      setCorrections(details.corrections);
      setCorrectionReason('');
      setPreview(null);
      setMessage('Attendance session loaded for review or correction.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The attendance session could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError('');
    setMessage('');
    const records = roster.map((student) => ({
      studentId: student.student_id,
      status: statuses[student.student_id] || '',
    }));
    if (records.some((record) => !record.status)) {
      setError('Select a valid attendance status for every enrolled student before saving.');
      return;
    }
    const hasChanges = records.some((record) => originalStatuses[record.studentId] !== record.status);
    if (sessionId && hasChanges && !correctionReason.trim()) {
      setError('Enter a reason for saving corrections to this attendance session.');
      return;
    }
    setBusy(true);
    try {
      if (sessionId) {
        await api.saveAttendance(sessionId, records, correctionReason.trim());
        setOriginalStatuses(Object.fromEntries(records.map((record) => [record.studentId, record.status as AttendanceStatus])));
        setMessage(hasChanges
          ? 'Attendance corrections saved and added to the audit history.'
          : 'No attendance changes were needed.');
      } else {
        const created = await api.createAttendanceSession(courseId, date, sessionTitle, records);
        const savedSession = created.session as Record<string, unknown>;
        setSessionId(String(savedSession.id || ''));
        setOriginalStatuses(Object.fromEntries(records.map((record) => [record.studentId, record.status as AttendanceStatus])));
        setMessage('Attendance session and all student records saved successfully.');
      }
      setPreview(null);
      setCorrectionReason('');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Attendance could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    const rows = [
      ['Date', 'Course ID', 'Student ID', 'Sessions', 'Present', 'Absent', 'Late', 'Excused', 'Attendance %'],
      ...report.map((item) => [
        item.date,
        item.courseId,
        item.studentId,
        item.total,
        item.present,
        item.absent,
        item.late,
        item.excused,
        item.percentage,
      ]),
    ];
    const blob = new Blob([`${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'attendance-report.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadPreviewErrors = () => {
    if (!preview) return;
    const errors = preview.rows.filter((row) => row.issues.length > 0);
    const rows = [
      ['Source Row', 'Student ID', 'Student Name', 'Attendance Status', 'Validation Issues'],
      ...errors.map((row) => [
        row.rowNumber ?? '',
        row.studentCode || row.studentId || '',
        row.studentName,
        row.status,
        row.issues.join('; '),
      ]),
    ];
    const blob = new Blob([`${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'attendance-upload-errors.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const filteredStudentSessions = sessions.filter((record) => {
      const session = record.attendance_sessions as Record<string, unknown> | undefined;
      const sessionDate = String(session?.session_date || '');
      return (!filterFrom || sessionDate >= filterFrom) && (!filterTo || sessionDate <= filterTo);
    });
    return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 md:p-8">
      <header><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Student attendance</p><h1 className="mt-1 text-xl font-bold text-slate-900">Your attendance</h1></header>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Card className="flex flex-wrap items-end gap-3 p-4"><label className="text-xs font-medium text-slate-600">From<input aria-label="Attendance from date" type="date" value={filterFrom} onChange={(event) => setFilterFrom(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-medium text-slate-600">To<input aria-label="Attendance to date" type="date" value={filterTo} onChange={(event) => setFilterTo(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><Button type="button" variant="outline" onClick={() => { setFilterFrom(''); setFilterTo(''); }}>Clear date filter</Button></Card>
      {!summary.length ? <Card className="p-6 text-sm text-slate-600">No attendance has been recorded yet.</Card> : <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">{summary.map((item) => {
        const course = courses.find((candidate) => candidate.id === item.courseId);
        return <Card key={item.courseId} className="p-5"><h2 className="font-semibold text-slate-900">{course?.code || item.courseId}</h2><p className="mt-2 text-3xl font-bold text-indigo-700">{item.percentage}%</p><p className="mt-1 text-xs text-slate-500">{item.present} present · {item.absent} absent · {item.total} recorded sessions</p></Card>;
      })}</div>}
      <Card className="p-5"><h2 className="mb-3 font-semibold text-slate-900">Session history</h2>{!filteredStudentSessions.length ? <p className="text-sm text-slate-600">No attendance sessions recorded for these dates.</p> : <div className="space-y-2">{filteredStudentSessions.map((record) => {
        const session = record.attendance_sessions as Record<string, unknown> | undefined;
        const course = courses.find((candidate) => candidate.id === String(session?.course_id || ''));
        return <div key={String(record.id)} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm"><span>{course?.code || String(session?.course_id || '')} · {String(session?.title || 'Session')} · {String(session?.session_date || '')}</span><strong className="capitalize">{String(record.status || '')}</strong></div>;
      })}</div>}</Card>
    </div>;
  }

  return <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 md:p-8">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{role === 'admin' ? 'Administrator reports' : 'Faculty workspace'}</p><h1 className="mt-1 text-xl font-bold text-slate-900">{role === 'admin' ? 'Class attendance reports' : 'Attendance management'}</h1></header>
    {error && <div role="alert" className="flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} />{error}</div>}
    {message && <div role="status" className="flex gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700"><CheckCircle2 size={16} />{message}</div>}

    {role === 'admin' && <Card className="space-y-3 p-5">
      <h2 className="font-semibold text-slate-900">Report filters</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <select aria-label="Filter by branch" value={filterBranchId} onChange={(event) => setFilterBranchId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All branches</option>{attendanceBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.departmentCode ? `${branch.departmentCode} · ` : ''}{branch.code} · {branch.name}</option>)}</select>
        <select aria-label="Filter by semester" value={filterSemesterId} onChange={(event) => setFilterSemesterId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All semesters</option>{Array.from(new Set(courses.map((course) => course.semesterId).filter((value): value is string => Boolean(value)))).map((semesterId) => <option key={semesterId} value={semesterId}>{semesterId}</option>)}</select>
        <select aria-label="Filter by course" value={filterCourseId} onChange={(event) => setFilterCourseId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title}</option>)}</select>
        <input aria-label="From date" type="date" value={filterFrom} onChange={(event) => setFilterFrom(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input aria-label="To date" type="date" value={filterTo} onChange={(event) => setFilterTo(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setFilterBranchId(''); setFilterSemesterId(''); setFilterCourseId(''); setFilterFrom(''); setFilterTo(''); }}>Clear</Button><Button type="button" variant="outline" onClick={downloadReport} icon={<Download size={15} />}>CSV</Button></div>
      </div>
    </Card>}

    {role === 'instructor' && <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold text-slate-900">{sessionId ? 'Review attendance session' : 'Record attendance'}</h2><p className="mt-1 text-xs text-slate-500">A valid status is required for every enrolled student. Supported uploads: CSV and XLSX.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!courseId || busy} onClick={() => void api.downloadAttendanceTemplate(courseId, 'csv').catch((reason) => setError(reason instanceof Error ? reason.message : 'Template download failed.'))} icon={<Download size={15} />}>CSV template</Button>
          <Button type="button" variant="outline" disabled={!courseId || busy} onClick={() => void api.downloadAttendanceTemplate(courseId, 'xlsx').catch((reason) => setError(reason instanceof Error ? reason.message : 'Template download failed.'))} icon={<Download size={15} />}>XLSX template</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label="Attendance course" value={courseId} disabled={Boolean(sessionId)} onChange={(event) => { setCourseId(event.target.value); setRoster([]); setStatuses({}); setPreview(null); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}{course.semesterId ? ` · Semester ${course.semesterId}` : ''}</option>)}</select>
        <input aria-label="Session date" type="date" value={date} disabled={Boolean(sessionId)} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input aria-label="Session or period name" placeholder="Period / session (e.g. Period 1)" value={sessionTitle} disabled={Boolean(sessionId)} onChange={(event) => setSessionTitle(event.target.value)} maxLength={200} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <Button type="button" disabled={!courseId || busy || Boolean(sessionId)} onClick={() => void loadRoster()} icon={<CalendarCheck size={15} />}>Load enrolled roster</Button>
      </div>
      {roster.length > 0 && <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <span>{roster.length} students · {statusCounts.present} present · {statusCounts.absent} absent · {statusCounts.late} late · {statusCounts.excused} excused · {statusCounts.unmarked} unmarked</span>
          <div className="flex flex-wrap gap-2">
            {(['present', 'absent'] as const).map((status) => <Button key={status} type="button" variant="outline" onClick={() => setStatuses(Object.fromEntries(roster.map((student) => [student.student_id, status])))}>Mark all {status}</Button>)}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><FileUp size={15} />Preview CSV/XLSX<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={busy} onChange={(event) => { void previewUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
          </div>
        </div>
        {preview && <section aria-label="Upload preview" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>Upload preview</strong><span>{preview.totalRows} file rows · {preview.validCount} valid · {preview.duplicateCount} duplicate · {preview.unknownCount} unknown · {preview.invalidCount} rows to review</span><Button type="button" variant="outline" onClick={downloadPreviewErrors} icon={<Download size={14} />}>Error report</Button></div>
          <p className="text-xs text-slate-600">Valid uploaded statuses are applied to the roster. Resolve missing or invalid statuses below. Unknown and duplicate file rows are not saved.</p>
          <div className="max-h-52 overflow-auto rounded border border-amber-100 bg-white"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">Row</th><th className="p-2">Student</th><th className="p-2">Status</th><th className="p-2">Issues</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={`${row.rowNumber ?? 'missing'}-${row.studentId ?? index}`} className="border-t border-slate-100"><td className="p-2">{row.rowNumber ?? '—'}</td><td className="p-2">{row.studentName}{row.studentCode ? ` · ${row.studentCode}` : ''}</td><td className="p-2 capitalize">{row.status || '—'}</td><td className="p-2 text-red-700">{row.issues.join(' ') || 'OK'}</td></tr>)}</tbody></table></div>
        </section>}
        <div className="flex items-center gap-2"><Search size={16} className="text-slate-400" /><input aria-label="Search roster" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search students by name, ID, or email" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
        <div className="max-h-[28rem] space-y-1 overflow-auto rounded-lg border border-slate-100 px-3">
          {visibleRoster.map((student) => <div key={student.student_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm">
            <span className="min-w-0"><span className="block font-medium text-slate-800">{student.studentName || student.studentCode || student.email || student.student_id}</span><span className="text-xs text-slate-500">{student.studentCode || student.email || student.student_id}</span></span>
            <select aria-label={`Attendance status for ${student.studentName || student.student_id}`} value={statuses[student.student_id] || ''} onChange={(event) => setStatuses((current) => ({ ...current, [student.student_id]: event.target.value as AttendanceStatus }))} className="rounded border border-slate-300 px-2 py-1.5"><option value="">Select status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>)}
          {!visibleRoster.length && <p className="p-4 text-sm text-slate-500">No students match this search.</p>}
        </div>
        {sessionId && <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">Correction reason<input value={correctionReason} maxLength={500} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Required when saving this existing session" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          {!!corrections.length && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Correction history ({corrections.length})</summary><div className="mt-2 space-y-2 text-xs text-slate-600">{corrections.map((item) => <p key={String(item.id)}>{String(item.created_at || '')} · {String(item.previous_status)} → {String(item.new_status)} · by {String(item.changed_by)} · {String(item.reason)}</p>)}</div></details>}
        </div>}
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => void save()} icon={<Save size={15} />}>{busy ? 'Saving…' : sessionId ? 'Save corrections' : 'Save attendance'}</Button>{sessionId && <Button type="button" variant="outline" onClick={() => { setSessionId(''); setCorrections([]); setCorrectionReason(''); setRoster([]); setStatuses({}); setOriginalStatuses({}); }}>New session</Button>}</div>
      </>}
    </Card>}

    {role === 'instructor' && <Card className="space-y-3 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Session history</h2><select aria-label="Filter sessions by course" value={historyCourseId} onChange={(event) => setHistoryCourseId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All assigned courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title}</option>)}</select></div>{!sessions.length ? <p className="text-sm text-slate-600">No attendance sessions recorded.</p> : <div className="space-y-2">{sessions.filter((session) => !historyCourseId || session.course_id === historyCourseId).map((session) => <div key={String(session.id)} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm"><span>{String(session.title)} · {String(session.session_date)} · {courses.find((course) => course.id === session.course_id)?.code || String(session.course_id)}</span><Button type="button" variant="outline" disabled={busy} onClick={() => void openSession(session)}>Review / correct</Button></div>)}</div>}</Card>}

    {role === 'admin' && <Card className="p-5"><h2 className="mb-3 font-semibold text-slate-900">Faculty submission activity</h2>{!activity.length ? <p className="text-sm text-slate-600">No attendance sessions match the selected filters.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="p-2">Course</th><th className="p-2">Faculty ID</th><th className="p-2">Sessions submitted</th><th className="p-2">Latest session</th><th className="p-2">Last submitted</th></tr></thead><tbody>{activity.map((item) => <tr key={`${item.courseId}-${item.facultyId}`} className="border-b border-slate-100"><td className="p-2">{courses.find((course) => course.id === item.courseId)?.code || item.courseId}</td><td className="p-2">{item.facultyId}</td><td className="p-2">{item.sessions}</td><td className="p-2">{item.latestSessionDate}</td><td className="p-2">{item.latestCreatedAt}</td></tr>)}</tbody></table></div>}</Card>}
    {role === 'admin' && <Card className="space-y-4 p-5"><h2 className="font-semibold text-slate-900">Branch summaries</h2>{!classReports.length ? <p className="text-sm text-slate-600">No branches are available for this institution.</p> : <div className="grid gap-3 sm:grid-cols-2">{classReports.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 p-4"><h3 className="font-medium text-slate-900">{item.departmentCode ? `${item.departmentCode} · ` : ''}{item.code} · {item.name}</h3><p className="mt-2 text-2xl font-bold text-indigo-700">{item.percentage}%</p><p className="mt-1 text-xs text-slate-600">{item.present} present · {item.absent} absent · {item.late} late · {item.excused} excused · {item.total} records</p></div>)}</div>}</Card>}
    {role === 'admin' && <Card className="p-5"><h2 className="mb-3 font-semibold text-slate-900">Daily student attendance detail</h2>{!report.length ? <p className="text-sm text-slate-600">No attendance records match the selected filters.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="p-2">Date</th><th className="p-2">Course</th><th className="p-2">Student ID</th><th className="p-2">Attendance</th><th className="p-2">Present</th><th className="p-2">Absent</th><th className="p-2">Late</th><th className="p-2">Excused</th></tr></thead><tbody>{report.map((item) => <tr key={`${item.courseId}-${item.studentId}-${item.date}`} className="border-b border-slate-100"><td className="p-2">{item.date}</td><td className="p-2">{courses.find((course) => course.id === item.courseId)?.code || item.courseId}</td><td className="p-2">{item.studentId}</td><td className="p-2">{item.percentage}%</td><td className="p-2">{item.present}</td><td className="p-2">{item.absent}</td><td className="p-2">{item.late}</td><td className="p-2">{item.excused}</td></tr>)}</tbody></table></div>}</Card>}
  </div>;
};
