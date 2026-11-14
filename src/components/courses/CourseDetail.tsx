import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  FileText,
  CheckSquare,
  Bot,
  User,
  Clock,
  Sparkles,
  Play
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Course, CourseMaterial, StudyDocument, Assessment, Topic } from '../../types';
import { api } from '../../services/api';
import { NavTab } from '../layout/Sidebar';

interface CourseDetailProps {
  course: Course;
  onBack: () => void;
  onNavigate: (tab: NavTab, params?: { courseId?: string; assessmentId?: string; topicQuery?: string }) => void;
}

export const CourseDetail: React.FC<CourseDetailProps> = ({
  course,
  onBack,
  onNavigate
}) => {
  const [documents, setDocuments] = useState<CourseMaterial[]>([]);
  const [tutorDocuments, setTutorDocuments] = useState<StudyDocument[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [foundation, setFoundation] = useState<Awaited<ReturnType<typeof api.getCourseAcademicFoundation>> | null>(null);
  const [submissionDrafts, setSubmissionDrafts] = useState<Record<string, string>>({});
  const [submissionStatus, setSubmissionStatus] = useState<Record<string, string>>({});
  const { role } = useAuth();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'topics' | 'materials' | 'assessments' | 'academic'>('topics');

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoadError(null);
      const [materialsResult, tutorDocsResult, assessmentsResult, foundationResult] = await Promise.allSettled([
        api.getCourseMaterials(),
        api.getDocuments(course.id),
        api.getAssessments(course.id),
        api.getCourseAcademicFoundation(course.id),
      ]);
      if (!active) return;
      if (materialsResult.status === 'fulfilled') {
        setDocuments(materialsResult.value.filter((material) => material.courseId === course.id));
      }
      if (tutorDocsResult.status === 'fulfilled') setTutorDocuments(tutorDocsResult.value);
      if (assessmentsResult.status === 'fulfilled') setAssessments(assessmentsResult.value);
      if (foundationResult.status === 'fulfilled') setFoundation(foundationResult.value);
      const failures = [materialsResult, tutorDocsResult, assessmentsResult, foundationResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) {
        setLoadError(failures[0].reason instanceof Error
          ? failures[0].reason.message
          : 'Some course data could not be loaded.');
      }
    };
    void loadData();
    return () => { active = false; };
  }, [course.id]);

  const submitAssignment = async (assignmentId: string) => {
    setSubmissionStatus((current) => ({ ...current, [assignmentId]: 'Saving…' }));
    try {
      await api.submitAssignment(assignmentId, submissionDrafts[assignmentId] || '');
      setSubmissionStatus((current) => ({ ...current, [assignmentId]: 'Submitted' }));
    } catch (error) {
      setSubmissionStatus((current) => ({
        ...current,
        [assignmentId]: error instanceof Error ? error.message : 'Submission failed.',
      }));
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Courses
      </button>

      {/* Course Banner Card */}
      <div className="p-6 md:p-8 bg-white border border-[#E2E8F0] rounded-xl shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#4338CA] bg-indigo-50 px-2 py-0.5 rounded">
                {course.code}
              </span>
              <span className="text-xs text-[#64748B]">{course.credits} Credits</span>
              <span className="text-xs text-[#64748B]">·</span>
              <span className="text-xs text-[#64748B]">Instructor: {course.instructor}</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0F172A]">
              {course.title}
            </h1>
            <p className="text-xs text-[#64748B] max-w-3xl leading-relaxed">
              {course.description}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row md:flex-col items-start md:items-end gap-3 shrink-0">
            <div className="text-right">
              <span className="text-2xl font-bold text-[#0F172A] tabular-nums">
                {course.progress}%
              </span>
              <span className="text-xs text-[#64748B] ml-1">completed</span>
            </div>
            <button
              onClick={() =>
                onNavigate('tutor', {
                  courseId: course.id,
                  topicQuery: `I am studying ${course.code} (${course.title}). What are the key concepts for this module?`
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] rounded-lg transition-colors shadow-xs"
            >
              <Bot className="w-3.5 h-3.5" />
              Discuss in AI Tutor
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      {loadError && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {loadError} Other course information remains available.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E2E8F0] pb-1">
        <button
          onClick={() => setActiveTab('topics')}
          className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-1 ${
            activeTab === 'topics'
              ? 'border-[#4338CA] text-[#4338CA]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          Curriculum Topics ({course.topics?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('materials')}
          className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-1 ${
            activeTab === 'materials'
              ? 'border-[#4338CA] text-[#4338CA]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          Study Materials & PDFs ({documents.length})
        </button>
        <button
          onClick={() => setActiveTab('assessments')}
          className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-1 ${
            activeTab === 'assessments'
              ? 'border-[#4338CA] text-[#4338CA]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          Diagnostic Quizzes ({assessments.length})
        </button>
        <button
          onClick={() => setActiveTab('academic')}
          className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-1 ${
            activeTab === 'academic' ? 'border-[#4338CA] text-[#4338CA]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          Academic Workspace
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'topics' && (
        <div className="space-y-3">
          {course.topics?.map((topic, index) => (
            <div
              key={topic.id}
              className="p-4 bg-white border border-[#E2E8F0] rounded-xl flex items-center justify-between gap-4 shadow-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-[#475569] text-xs font-bold flex items-center justify-center shrink-0">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-[#0F172A] truncate">
                      {topic.title}
                    </h3>
                    {topic.isCompleted && (
                      <span className="text-[10px] font-semibold text-[#15803D] bg-green-50 px-1.5 py-0.5 rounded">
                        Mastered
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[#64748B] mt-0.5">
                    <span>~{topic.estimatedMinutes} min</span>
                    <span>·</span>
                    <span>{topic.resourcesCount} resources indexed</span>
                    {topic.masteryScore !== undefined && (
                      <>
                        <span>·</span>
                        <span className="font-semibold text-[#0F172A] tabular-nums">
                          {topic.masteryScore}% mastery
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() =>
                    onNavigate('tutor', {
                      courseId: course.id,
                      topicQuery: `Explain the concept: ${topic.title} in ${course.code}`
                    })
                  }
                  className="px-3 py-1.5 text-xs font-medium text-[#4338CA] bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                >
                  Study with Tutor
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'materials' && (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="p-4 bg-white border border-[#E2E8F0] rounded-xl flex items-center justify-between gap-4 shadow-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-[#4338CA] flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-[#0F172A] truncate">
                    {doc.title}
                  </h3>
                  <div className="flex items-center gap-3 text-[11px] text-[#64748B] mt-0.5">
                    <span>{doc.category.replace('_', ' ')}</span>
                    <span>·</span>
                    <span>{doc.fileType.toUpperCase()}</span>
                    <span>·</span>
                    <span>Uploaded by {doc.uploadedBy}</span>
                    <span>·</span>
                    <span>{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : 'Date unavailable'}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  try {
                    const download = await api.getCourseMaterialDownload(doc.id);
                    window.open(download.url, '_blank', 'noopener,noreferrer');
                  } catch (error) {
                    setLoadError(error instanceof Error ? error.message : 'The course material could not be opened.');
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium text-[#4338CA] bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors shrink-0"
              >
                View / Download
              </button>
            </div>
          ))}
          {documents.length === 0 && (
            <p className="rounded-lg border border-[#E2E8F0] bg-white p-4 text-xs text-[#64748B]">
              No published course materials are available yet.
            </p>
          )}
          {tutorDocuments.length > 0 && (
            <div className="space-y-2 border-t border-[#E2E8F0] pt-4">
              <h3 className="text-xs font-semibold text-[#334155]">Existing AI Tutor documents</h3>
              {tutorDocuments.map((document) => (
                <div key={document.id} className="flex flex-col justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#0F172A]">{document.title}</p>
                    <p className="mt-1 text-[11px] text-[#64748B]">{document.fileSize} · {document.status}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('tutor', {
                      courseId: course.id,
                      topicQuery: `Based on ${document.title}, what are the most critical exam topics?`,
                    })}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-indigo-50 px-3 py-1.5 text-xs font-medium text-[#4338CA] hover:bg-indigo-100"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Ask Tutor
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'assessments' && (
        <div className="space-y-3">
          {assessments.map((asmt) => (
            <div
              key={asmt.id}
              className="p-4 bg-white border border-[#E2E8F0] rounded-xl flex items-center justify-between gap-4 shadow-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-[#4338CA] flex items-center justify-center shrink-0">
                  <CheckSquare className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-[#0F172A] truncate">
                    {asmt.title}
                  </h3>
                  <div className="flex items-center gap-3 text-[11px] text-[#64748B] mt-0.5">
                    <span>{asmt.difficulty}</span>
                    <span>·</span>
                    <span>{asmt.questionCount} Questions</span>
                    <span>·</span>
                    <span>{asmt.durationMinutes} min limit</span>
                    {asmt.bestScore !== undefined && (
                      <>
                        <span>·</span>
                        <span className="font-semibold text-[#0F172A] tabular-nums">
                          Best: {asmt.bestScore}%
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => onNavigate('assessments', { assessmentId: asmt.id })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] rounded-md transition-colors shrink-0"
              >
                <Play className="w-3 h-3 fill-current" />
                Take Assessment
              </button>
            </div>
          ))}
        </div>
      )}
      {activeTab === 'academic' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#0F172A]">Course outcomes and units</h2>
            {foundation?.outcomes.length ? foundation.outcomes.map((outcome) => (
              <div key={outcome.id} className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold text-[#4338CA]">{outcome.code}</p>
                <p className="mt-1 text-xs text-[#475569]">{outcome.description}</p>
              </div>
            )) : <p className="text-xs text-[#64748B]">Course outcomes are not published.</p>}
            <div className="space-y-2">
              {foundation?.units.map((unit) => (
                <div key={unit.id} className="border-t border-slate-100 pt-2">
                  <p className="text-xs font-semibold text-[#0F172A]">Unit {unit.unit_number}: {unit.title}</p>
                  {unit.description && <p className="mt-1 text-xs text-[#64748B]">{unit.description}</p>}
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#0F172A]">Announcements and assignments</h2>
            {foundation?.announcements.map((announcement) => (
              <article key={announcement.id} className="rounded-lg border border-slate-100 p-3">
                <h3 className="text-xs font-semibold text-[#0F172A]">{announcement.title}</h3>
                <p className="mt-1 whitespace-pre-wrap text-xs text-[#475569]">{announcement.content}</p>
              </article>
            ))}
            {foundation?.assignments.map((assignment) => (
              <article key={assignment.id} className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#0F172A]">{assignment.title}</h3>
                  <span className="text-[11px] text-[#64748B]">{assignment.max_points} points</span>
                </div>
                <p className="mt-1 text-xs text-[#475569]">{assignment.description}</p>
                {role === 'student' && assignment.status !== 'draft' && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={submissionDrafts[assignment.id] || ''}
                      onChange={(event) => setSubmissionDrafts((current) => ({ ...current, [assignment.id]: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                      rows={3}
                      placeholder="Write your submission..."
                    />
                    <button type="button" onClick={() => void submitAssignment(assignment.id)} className="rounded-lg bg-[#4338CA] px-3 py-2 text-xs font-semibold text-white">
                      Submit assignment
                    </button>
                    {submissionStatus[assignment.id] && <p role="status" className="text-[11px] text-[#475569]">{submissionStatus[assignment.id]}</p>}
                  </div>
                )}
              </article>
            ))}
            {!foundation?.announcements.length && !foundation?.assignments.length && <p className="text-xs text-[#64748B]">No published announcements or assignments are available.</p>}
          </section>
        </div>
      )}
    </div>
  );
};
