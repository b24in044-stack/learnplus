import React, { useState, useEffect } from 'react';
import {
  Users,
  BookOpen,
  FileCheck,
  Activity,
  Plus,
  Sparkles,
  Bot,
  CheckCircle,
  Clock,
  Layers,
  ArrowRight,
  ShieldAlert,
  Server,
  AlertTriangle,
  Upload,
  FileText,
  Sliders,
  Database,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { Course, FacultyAssessmentDraft, StudyDocument } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface InstructorWorkspaceProps {
  courses: Course[];
}

export const InstructorWorkspace: React.FC<InstructorWorkspaceProps> = ({ courses }) => {
  const { role, user } = useAuth();
  const [activeCourseId, setActiveCourseId] = useState(courses[0]?.id || '');
  const [activeTab, setActiveTab] = useState<'roster' | 'generator' | 'curriculum' | 'telemetry'>('roster');
  const [roster, setRoster] = useState<Awaited<ReturnType<typeof api.getFacultyCourseRoster>>>([]);
  const [isRosterLoading, setIsRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [facultyActionError, setFacultyActionError] = useState<string | null>(null);

  // Generator state
  const [genTopic, setGenTopic] = useState('AVL Tree Invariants & Rotations');
  const [genCount, setGenCount] = useState(3);
  const [genDifficulty, setGenDifficulty] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [genBloom, setGenBloom] = useState('Analysis & Evaluation');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<FacultyAssessmentDraft | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // Course documents
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [foundation, setFoundation] = useState<Awaited<ReturnType<typeof api.getCourseAcademicFoundation>> | null>(null);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [assignmentDescription, setAssignmentDescription] = useState('');
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterFilter, setRosterFilter] = useState<'all' | 'support' | 'no-score'>('all');
  const [rosterSort, setRosterSort] = useState<'name' | 'score' | 'activity'>('name');

  const activeCourse = courses.find((c) => c.id === activeCourseId) || courses[0];
  const visibleRoster = [...roster]
    .filter((student) => {
      const query = rosterQuery.trim().toLowerCase();
      const matchesQuery = !query
        || student.name.toLowerCase().includes(query)
        || student.email.toLowerCase().includes(query);
      const matchesFilter = rosterFilter === 'all'
        || (rosterFilter === 'support' && student.status === 'Needs Support')
        || (rosterFilter === 'no-score' && student.score === '—');
      return matchesQuery && matchesFilter;
    })
    .sort((left, right) => {
      if (rosterSort === 'score') {
        const leftScore = Number.parseFloat(left.score);
        const rightScore = Number.parseFloat(right.score);
        return (Number.isFinite(rightScore) ? rightScore : -1) - (Number.isFinite(leftScore) ? leftScore : -1);
      }
      if (rosterSort === 'activity') return left.lastActive.localeCompare(right.lastActive);
      return left.name.localeCompare(right.name);
    });

  useEffect(() => {
    if (courses.length && !courses.some((course) => course.id === activeCourseId)) {
      setActiveCourseId(courses[0].id);
    }
  }, [courses, activeCourseId]);

  useEffect(() => {
    let active = true;
    setDocuments([]);
    setDocumentsError(null);
    if (!activeCourseId) return () => { active = false; };
    const loadDocs = async () => {
      try {
        const [courseDocs, courseFoundation] = await Promise.all([
          api.getDocuments(activeCourseId),
          api.getCourseAcademicFoundation(activeCourseId),
        ]);
        if (active) {
          setDocuments(courseDocs);
          setFoundation(courseFoundation);
        }
      } catch (error) {
        if (active) setDocumentsError(error instanceof Error ? error.message : 'Unable to load course documents.');
      }
    };
    void loadDocs();
    return () => { active = false; };
  }, [activeCourseId, user.id]);

  const createFacultyResource = async (resource: 'announcements' | 'assignments') => {
    if (!activeCourseId) return;
    setFacultyActionError(null);
    try {
      await api.createCourseAcademicResource(activeCourseId, resource, resource === 'announcements'
        ? { title: announcementTitle, content: announcementContent, status: 'published' }
        : { title: assignmentTitle, description: assignmentDescription, status: 'published' });
      setAnnouncementTitle('');
      setAnnouncementContent('');
      setAssignmentTitle('');
      setAssignmentDescription('');
      setFoundation(await api.getCourseAcademicFoundation(activeCourseId));
    } catch (error) {
      setFacultyActionError(error instanceof Error ? error.message : 'Academic resource could not be saved.');
    }
  };

  useEffect(() => {
    let active = true;
    setRoster([]);
    setRosterError(null);
    if (!activeCourseId || role !== 'instructor' || !user.id) {
      setIsRosterLoading(false);
      return () => { active = false; };
    }
    setIsRosterLoading(true);
    api.getFacultyCourseRoster(activeCourseId).then((students) => {
      if (active) setRoster(students);
    }).catch((error: unknown) => {
      if (active) setRosterError(error instanceof Error ? error.message : 'Unable to load the course roster.');
    }).finally(() => {
      if (active) setIsRosterLoading(false);
    });
    return () => { active = false; };
  }, [activeCourseId, role, user.id]);

  if (role !== 'instructor') {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card className="p-6 text-center space-y-3 border-amber-200 bg-amber-50/50">
          <ShieldAlert className="w-8 h-8 text-[#B45309] mx-auto" />
          <h2 className="text-sm font-semibold text-[#0F172A]">Instructor Access Restricted</h2>
          <p className="text-xs text-[#64748B]">
            This portal is restricted to university faculty accounts. Switch your role to Faculty in the bottom sidebar menu to preview instructor workflows.
          </p>
        </Card>
      </div>
    );
  }

  if (!activeCourse) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card className="p-6 text-center space-y-3">
          <h2 className="text-sm font-semibold text-[#0F172A]">No courses assigned</h2>
          <p className="text-xs text-[#64748B]">Courses assigned to your faculty account will appear here.</p>
        </Card>
      </div>
    );
  }

  const handleGenerateAssessment = async () => {
    setIsGenerating(true);
    setPublishSuccess(false);
    setFacultyActionError(null);
    try {
      const draft = await api.generateFacultyAssessmentDraft({
        courseId: activeCourse.id,
        topic: genTopic,
        difficulty: genDifficulty,
        questionCount: genCount,
        bloomLevel: genBloom
      });
      setGeneratedDraft(draft);
    } catch (err) {
      setFacultyActionError(err instanceof Error ? err.message : 'Assessment generation is unavailable.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePublishAssessment = async () => {
    if (!generatedDraft) return;
    setIsPublishing(true);
    setFacultyActionError(null);
    try {
      await api.publishFacultyAssessment(generatedDraft);
      setPublishSuccess(true);
    } catch (err) {
      setFacultyActionError(err instanceof Error ? err.message : 'Assessment publishing is unavailable.');
    } finally {
      setIsPublishing(false);
    }
  };

  const updateGeneratedDraft = (patch: Partial<FacultyAssessmentDraft>) => {
    setGeneratedDraft((current) => current ? { ...current, ...patch } : current);
  };

  const updateGeneratedQuestion = (
    questionIndex: number,
    patch: Partial<FacultyAssessmentDraft['questions'][number]>,
  ) => {
    setGeneratedDraft((current) => current ? {
      ...current,
      questions: current.questions.map((question, index) =>
        index === questionIndex ? { ...question, ...patch } : question
      ),
    } : current);
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="teal">Faculty Portal</Badge>
            <span className="text-xs text-[#64748B]">Course administration and student progress</span>
          </div>
          <h1 className="text-xl font-bold text-[#0F172A] mt-1 tracking-tight">
            Curriculum Administration & Cohort Diagnostics
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Logged in as <strong className="text-[#0F172A]">{user.name}</strong> · {user.department}
          </p>
        </div>

        {courses.length > 0 && (
          <select
            value={activeCourseId}
            onChange={(e) => setActiveCourseId(e.target.value)}
            className="bg-white border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2 outline-none focus:border-[#4338CA] shadow-xs"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {facultyActionError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{facultyActionError}</p>}

      {/* Cohort KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <span className="text-xs font-semibold text-[#64748B]">Enrolled Cohort</span>
          <p className="mt-1.5 text-2xl font-bold text-[#0F172A] tabular-nums">
            {isRosterLoading || rosterError ? '—' : roster.length}
          </p>
          <span className="text-[11px] text-[#64748B] mt-0.5 block">Students enrolled in this course</span>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-semibold text-[#64748B]">Cohort Mean Grade</span>
          <p className="mt-1.5 text-2xl font-bold text-[#0F172A] tabular-nums">
            {(() => {
              const scores = roster.map((student) => Number.parseFloat(student.score)).filter(Number.isFinite);
              return scores.length ? `${(scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1)}%` : '—';
            })()}
          </p>
          <span className="text-[11px] text-[#64748B] mt-0.5 block">Based on recorded assessment submissions</span>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-semibold text-[#64748B]">Students Flagged for Support</span>
          <p className="mt-1.5 text-2xl font-bold text-[#B45309] tabular-nums">
            {rosterError ? '—' : `${roster.filter((student) => student.status === 'Needs Support').length} Students`}
          </p>
          <span className="text-[11px] text-[#B45309] mt-0.5 block font-medium">Below 70% mean assessment score</span>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-semibold text-[#64748B]">Course Documents</span>
          <p className="mt-1.5 text-2xl font-bold text-[#0F172A] tabular-nums">
            {documents.length}
          </p>
          <span className="text-[11px] text-[#64748B] mt-0.5 block">Document processing is not configured</span>
        </Card>
      </div>

      {/* Faculty Portal Sub-Navigation Tabs */}
      <div className="border-b border-[#E2E8F0] flex items-center gap-6 text-xs font-semibold text-[#64748B]">
        <button
          onClick={() => setActiveTab('roster')}
          className={`pb-3 cursor-pointer transition-colors ${
            activeTab === 'roster'
              ? 'border-b-2 border-[#4338CA] text-[#4338CA]'
              : 'hover:text-[#0F172A]'
          }`}
        >
          Cohort Roster & Diagnostic Interventions
        </button>

        <button
          onClick={() => setActiveTab('generator')}
          className={`pb-3 cursor-pointer transition-colors flex items-center gap-1.5 ${
            activeTab === 'generator'
              ? 'border-b-2 border-[#4338CA] text-[#4338CA]'
              : 'hover:text-[#0F172A]'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[#4338CA]" />
          <span>AI Assessment Generator</span>
        </button>

        <button
          onClick={() => setActiveTab('curriculum')}
          className={`pb-3 cursor-pointer transition-colors ${
            activeTab === 'curriculum'
              ? 'border-b-2 border-[#4338CA] text-[#4338CA]'
              : 'hover:text-[#0F172A]'
          }`}
        >
          Course Documents ({documents.length})
        </button>

        <button
          onClick={() => setActiveTab('telemetry')}
          className={`pb-3 cursor-pointer transition-colors ${
            activeTab === 'telemetry'
              ? 'border-b-2 border-[#4338CA] text-[#4338CA]'
              : 'hover:text-[#0F172A]'
          }`}
        >
          Service Status
        </button>
      </div>

      {/* TAB 1: COHORT ROSTER */}
      {activeTab === 'roster' && (
        <Card className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Class Roster & Automated Diagnostic Interventions · {activeCourse?.code}
              </h2>
              <p className="text-xs text-[#64748B]">
                Course enrollment and recorded assessment performance.
              </p>
            </div>
            <Badge variant="indigo">{roster.length} Students</Badge>
          </div>

          {rosterError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{rosterError}</p>}
          {documentsError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{documentsError}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={rosterQuery}
              onChange={(event) => setRosterQuery(event.target.value)}
              placeholder="Search students..."
              aria-label="Search students"
              className="flex-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
            />
            <select
              value={rosterFilter}
              onChange={(event) => setRosterFilter(event.target.value as typeof rosterFilter)}
              aria-label="Filter roster"
              className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
            >
              <option value="all">All students</option>
              <option value="support">Needs support</option>
              <option value="no-score">No assessment score</option>
            </select>
            <select
              value={rosterSort}
              onChange={(event) => setRosterSort(event.target.value as typeof rosterSort)}
              aria-label="Sort roster"
              className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
            >
              <option value="name">Sort by name</option>
              <option value="score">Sort by score</option>
              <option value="activity">Sort by activity</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[#64748B] font-semibold">
                  <th className="pb-3">Student Name</th>
                  <th className="pb-3">Institutional Email</th>
                  <th className="pb-3">Mean Score</th>
                  <th className="pb-3">Diagnostic Status</th>
                  <th className="pb-3">Detected Weak Concept</th>
                  <th className="pb-3 text-right">Intervention Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {isRosterLoading ? (
                  <tr><td colSpan={6} className="py-6 text-center text-[#64748B]">Loading course roster…</td></tr>
                ) : rosterError ? (
                  <tr><td colSpan={6} className="py-6 text-center text-[#64748B]">Roster data is unavailable.</td></tr>
                ) : visibleRoster.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-[#64748B]">No students are enrolled in this course yet.</td></tr>
                ) : visibleRoster.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="py-3 font-semibold text-[#0F172A]">{s.name}</td>
                    <td className="py-3 text-[#64748B] font-mono">{s.email}</td>
                    <td className="py-3 font-bold text-[#0F172A] tabular-nums">{s.score}</td>
                    <td className="py-3">
                      <Badge
                        variant={
                          s.status === 'Advanced'
                            ? 'teal'
                            : s.status === 'On Track'
                            ? 'indigo'
                            : 'red'
                        }
                      >
                        {s.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-[#64748B]">{s.weakArea}</td>
                    <td className="py-3 text-right">
                      <span className="text-[11px] text-[#64748B]">Not configured</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 2: AI ASSESSMENT GENERATOR */}
      {activeTab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form Side (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#4338CA]" />
                <h2 className="text-sm font-semibold text-[#0F172A]">
                  AI Assessment Synthesizer
                </h2>
              </div>

              <p className="text-xs text-[#64748B] leading-relaxed">
                Generate an unpublished Groq draft for this course. Review every question before publishing it to enrolled students.
              </p>

              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Target Syllabus Concept</label>
                  <input
                    type="text"
                    value={genTopic}
                    onChange={(e) => setGenTopic(e.target.value)}
                    placeholder="e.g. AVL Tree Invariants & Rotations"
                    className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#0F172A]">Difficulty</label>
                    <select
                      value={genDifficulty}
                      onChange={(e) => setGenDifficulty(e.target.value as FacultyAssessmentDraft['difficulty'])}
                      className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
                    >
                      <option value="Beginner">Beginner</option>
                      <option value="Intermediate">Intermediate</option>
                      <option value="Advanced">Advanced</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#0F172A]">Question Count</label>
                    <select
                      value={genCount}
                      onChange={(e) => setGenCount(Number(e.target.value))}
                      className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
                    >
                      <option value={3}>3 Questions</option>
                      <option value={5}>5 Questions</option>
                      <option value={10}>10 Questions</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#0F172A]">Bloom's Taxonomy Level</label>
                  <select
                    value={genBloom}
                    onChange={(e) => setGenBloom(e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
                  >
                    <option value="Knowledge & Recall">Knowledge & Recall</option>
                    <option value="Application & Code Analysis">Application & Code Analysis</option>
                    <option value="Analysis & Evaluation">Analysis & Evaluation</option>
                  </select>
                </div>

                <Button
                  variant="primary"
                  size="md"
                  className="w-full mt-2"
                  disabled={isGenerating || !genTopic.trim()}
                  icon={<Bot className="w-3.5 h-3.5" />}
                  onClick={handleGenerateAssessment}
                >
                  {isGenerating ? 'Generating draft…' : 'Generate assessment draft'}
                </Button>
              </div>
            </Card>
          </div>

          {/* Draft Preview Side (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            {generatedDraft ? (
              <Card className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-[#4338CA] uppercase tracking-wider">
                      {generatedDraft.courseCode} · Generated Draft
                    </span>
                    <input
                      value={generatedDraft.title}
                      onChange={(event) => updateGeneratedDraft({ title: event.target.value })}
                      aria-label="Assessment title"
                      className="mt-1 w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-sm font-bold text-[#0F172A] outline-none focus:border-[#4338CA]"
                    />
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={isPublishing}
                    onClick={handlePublishAssessment}
                    icon={<Upload className="w-3.5 h-3.5" />}
                  >
                    Publish to Class
                  </Button>
                </div>

                {publishSuccess && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-[#15803D] flex items-center gap-2 font-medium">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span>Assessment published successfully! Students can now access it in their Assessments portal.</span>
                  </div>
                )}

                <div className="space-y-4 pt-2 divide-y divide-[#F1F5F9]">
                  {generatedDraft.questions.map((q, idx) => (
                    <div key={q.id} className="pt-3 space-y-2">
                      <div className="flex items-center justify-between text-xs text-[#64748B]">
                        <span className="font-bold text-[#0F172A]">Question {idx + 1}</span>
                        <Badge variant="neutral">{q.topicTag}</Badge>
                      </div>

                      <textarea
                        value={q.questionText}
                        onChange={(event) => updateGeneratedQuestion(idx, { questionText: event.target.value })}
                        aria-label={`Question ${idx + 1} text`}
                        rows={3}
                        className="w-full rounded-lg border border-[#E2E8F0] px-2.5 py-2 text-xs text-[#0F172A] outline-none focus:border-[#4338CA]"
                      />

                      {q.codeSnippet && (
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto">
                          {q.codeSnippet}
                        </pre>
                      )}

                      <div className="space-y-1.5 pt-1">
                        {q.options.map((opt, optIdx) => (
                          <div
                            key={optIdx}
                            className={`p-2 rounded-lg text-xs flex items-center gap-2 border ${
                              optIdx === q.correctOptionIndex
                                ? 'bg-green-50 border-green-200 text-[#15803D] font-semibold'
                                : 'bg-slate-50 border-[#E2E8F0] text-[#475569]'
                            }`}
                          >
                            <span className="w-4 h-4 rounded-full border flex items-center justify-center text-[10px]">
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <input
                              value={opt}
                              onChange={(event) => updateGeneratedQuestion(idx, {
                                options: q.options.map((option, optionIndex) =>
                                  optionIndex === optIdx ? event.target.value : option
                                ),
                              })}
                              aria-label={`Question ${idx + 1} option ${String.fromCharCode(65 + optIdx)}`}
                              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                            />
                            {optIdx === q.correctOptionIndex && (
                              <span className="ml-auto text-[10px] bg-green-200/60 text-green-800 px-1.5 py-0.5 rounded">
                                Correct Answer
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <label className="text-[11px] font-semibold text-[#64748B]">
                          Correct answer
                          <select
                            value={q.correctOptionIndex}
                            onChange={(event) => updateGeneratedQuestion(idx, { correctOptionIndex: Number(event.target.value) })}
                            aria-label={`Correct answer for question ${idx + 1}`}
                            className="ml-2 rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] text-[#0F172A]"
                          >
                            {q.options.map((_, optionIndex) => (
                              <option key={optionIndex} value={optionIndex}>
                                {String.fromCharCode(65 + optionIndex)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <textarea
                        value={q.explanation}
                        onChange={(event) => updateGeneratedQuestion(idx, { explanation: event.target.value })}
                        aria-label={`Rationale for question ${idx + 1}`}
                        rows={2}
                        className="w-full rounded-lg border border-[#E2E8F0] px-2.5 py-2 text-[11px] italic text-[#64748B] outline-none focus:border-[#4338CA]"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="p-12 text-center space-y-3 border-dashed">
                <Bot className="w-10 h-10 text-[#94A3B8] mx-auto" />
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  No Assessment Draft Generated Yet
                </h3>
                <p className="text-xs text-[#64748B] max-w-sm mx-auto">
                  AI question generation is unavailable until an AI provider is configured.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CURRICULUM & SYLLABUS VECTOR STORE */}
      {activeTab === 'curriculum' && (
        <Card className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Course Documents
              </h2>
              <p className="text-xs text-[#64748B]">
                Files are stored securely. Text extraction, embeddings, and tutor retrieval are not configured.
              </p>
            </div>
            <Badge variant="indigo">Processing unavailable</Badge>
          </div>

          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="p-4 border border-[#E2E8F0] rounded-xl bg-slate-50/50 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#4338CA]" />
                    <span className="text-xs font-bold text-[#0F172A]">{doc.title}</span>
                  </div>
                  <Badge variant={doc.status === 'FAILED' ? 'red' : 'indigo'}>{doc.status}</Badge>
                </div>

                <p className="text-xs text-[#64748B] leading-relaxed">
                  {doc.vectorStatus || 'Document processing is not configured.'}
                </p>

                <div className="flex items-center gap-4 text-[11px] text-[#64748B] pt-1">
                  <span>File Size: <strong className="text-[#0F172A]">{doc.fileSize}</strong></span>
                  <span>Uploaded: <strong className="text-[#0F172A]">{new Date(doc.uploadedAt).toLocaleString()}</strong></span>
                </div>
              </div>
            ))}
            {documents.length === 0 && !documentsError && <p className="py-6 text-center text-xs text-[#64748B]">No documents have been uploaded for this course.</p>}
          </div>
          <div className="grid gap-4 border-t border-[#E2E8F0] pt-5 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#0F172A]">Publish announcement</h3>
              <input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} placeholder="Announcement title" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <textarea value={announcementContent} onChange={(event) => setAnnouncementContent(event.target.value)} placeholder="Message for enrolled students" rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <Button type="button" variant="primary" onClick={() => void createFacultyResource('announcements')} disabled={!announcementTitle.trim() || !announcementContent.trim()}>Publish announcement</Button>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#0F172A]">Create assignment</h3>
              <input value={assignmentTitle} onChange={(event) => setAssignmentTitle(event.target.value)} placeholder="Assignment title" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <textarea value={assignmentDescription} onChange={(event) => setAssignmentDescription(event.target.value)} placeholder="Instructions and requirements" rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <Button type="button" variant="primary" onClick={() => void createFacultyResource('assignments')} disabled={!assignmentTitle.trim()}>Publish assignment</Button>
            </div>
          </div>
          {foundation?.assignments.length ? <p className="text-xs text-[#64748B]">{foundation.assignments.length} assignment(s) published for this course.</p> : null}
        </Card>
      )}

      {/* TAB 4: SERVICE STATUS */}
      {activeTab === 'telemetry' && (
        <Card className="p-6 space-y-2">
          <h2 className="text-sm font-semibold text-[#0F172A]">AI and retrieval services are not configured</h2>
          <p className="text-xs text-[#64748B]">
            This deployment does not currently provide AI-provider calls, document extraction, embeddings, or agent telemetry. No service latency or grounding metrics are available.
          </p>
        </Card>
      )}

    </div>
  );
};
