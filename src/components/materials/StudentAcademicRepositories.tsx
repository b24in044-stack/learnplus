import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import {
  AcademicDocument,
  StudentAcademicContext,
  VerifiedSemesterResult,
  VerifiedSubjectMark,
} from '../../types';
import { AcademicFilters, api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';

type RepositoryKind = 'materials' | 'question-papers' | 'answer-keys';
type AcademicResource = 'profile' | 'materials' | 'papers' | 'answerKeys' | 'marks' | 'results';

const repositories: {
  kind: RepositoryKind;
  title: string;
  label: string;
}[] = [
  { kind: 'materials', title: 'Educational Materials', label: 'Syllabus, textbooks, notes, PDFs and lab manuals' },
  { kind: 'question-papers', title: 'Previous Examination Papers', label: 'Published papers from previous semesters' },
  { kind: 'answer-keys', title: 'Official University Answer Keys', label: 'Official keys, visible only after release' },
];

const documentMatches = (document: AcademicDocument, filters: AcademicFilters) =>
  Object.entries(filters).every(([field, value]) =>
    !value || String(document[field as keyof AcademicDocument] ?? '') === value);

function AcademicDocumentList({
  documents,
  repository,
  onDownload,
  onIndex,
  processingDocumentId,
}: {
  documents: AcademicDocument[];
  repository: RepositoryKind;
  onDownload: (kind: RepositoryKind, document: AcademicDocument) => void;
  onIndex: (document: AcademicDocument) => void;
  processingDocumentId: string | null;
}) {
  if (!documents.length) {
    return (
      <EmptyState
        icon={<FileText className="w-6 h-6" />}
        title="No published documents found"
        description="No published records match your enrollment and selected filters."
      />
    );
  }
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-xs divide-y divide-[#E2E8F0]">
      {documents.map((document) => (
        <div key={document.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-[#4338CA] flex items-center justify-center shrink-0 border border-indigo-100">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-[#0F172A]">{document.title}</h4>
              <p className="text-[11px] text-[#64748B] mt-1">
                {[document.subjectId, document.academicYearId, document.semesterId, document.examinationType]
                  .filter(Boolean)
                  .join(' · ') || document.courseId || 'University publication'}
              </p>
              {repository === 'materials' && (
                <p className="text-[11px] text-[#64748B] mt-1">
                  {document.category?.replace('_', ' ') || 'Other materials'}
                  {document.fileType ? ` · ${document.fileType.toUpperCase()}` : ''}
                  {document.uploadedBy ? ` · Uploaded by ${document.uploadedBy}` : ''}
                  {document.uploadedAt ? ` · ${new Date(document.uploadedAt).toLocaleDateString()}` : ''}
                </p>
              )}
              {document.provenance && (
                <p className="text-[11px] text-[#64748B] mt-1">
                  Source: {document.provenance.sourceName || document.provenance.sourceReference || 'Verified university record'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {document.official && <Badge variant="success">OFFICIAL</Badge>}
            {repository === 'materials' && document.documentId && document.courseId && (
              <button
                type="button"
                onClick={() => onIndex(document)}
                disabled={document.ragReady || processingDocumentId === document.id}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-[#4338CA] hover:bg-indigo-100 disabled:opacity-60"
              >
                {processingDocumentId === document.id
                  ? 'Indexing...'
                  : document.ragReady ? 'AI Tutor Ready' : 'Index for AI Tutor'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDownload(repository, document)}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-[#4338CA] hover:bg-indigo-100"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export const StudentAcademicRepositories: React.FC = () => {
  const { user } = useAuth();
  const [context, setContext] = useState<StudentAcademicContext | null>(null);
  const [materials, setMaterials] = useState<AcademicDocument[]>([]);
  const [papers, setPapers] = useState<AcademicDocument[]>([]);
  const [answerKeys, setAnswerKeys] = useState<AcademicDocument[]>([]);
  const [marks, setMarks] = useState<VerifiedSubjectMark[]>([]);
  const [results, setResults] = useState<VerifiedSemesterResult[]>([]);
  const [filters, setFilters] = useState<AcademicFilters>({});
  const [errors, setErrors] = useState<Partial<Record<AcademicResource, string>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [processingDocumentId, setProcessingDocumentId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setErrors({});
    Promise.allSettled([
      api.getStudentAcademicContext(),
      api.getEducationalMaterials(filters),
      api.getPreviousQuestionPapers(filters),
      api.getOfficialAnswerKeys(filters),
      api.getVerifiedSubjectMarks(filters),
      api.getVerifiedSemesterResults(filters),
    ]).then((outcomes) => {
      if (!active) return;
      const failures: Partial<Record<AcademicResource, string>> = {};
      const [profile, materialRows, paperRows, keyRows, markRows, resultRows] = outcomes;
      if (profile.status === 'fulfilled') setContext(profile.value);
      else {
        setContext(null);
        failures.profile = profile.reason instanceof Error ? profile.reason.message : 'Academic profile could not be loaded.';
      }
      if (materialRows.status === 'fulfilled') setMaterials(materialRows.value);
      else {
        setMaterials([]);
        failures.materials = materialRows.reason instanceof Error ? materialRows.reason.message : 'Educational materials could not be loaded.';
      }
      if (paperRows.status === 'fulfilled') setPapers(paperRows.value);
      else {
        setPapers([]);
        failures.papers = paperRows.reason instanceof Error ? paperRows.reason.message : 'Previous papers could not be loaded.';
      }
      if (keyRows.status === 'fulfilled') setAnswerKeys(keyRows.value);
      else {
        setAnswerKeys([]);
        failures.answerKeys = keyRows.reason instanceof Error ? keyRows.reason.message : 'Official answer keys could not be loaded.';
      }
      if (markRows.status === 'fulfilled') setMarks(markRows.value);
      else {
        setMarks([]);
        failures.marks = markRows.reason instanceof Error ? markRows.reason.message : 'Verified marks could not be loaded.';
      }
      if (resultRows.status === 'fulfilled') setResults(resultRows.value);
      else {
        setResults([]);
        failures.results = resultRows.reason instanceof Error ? resultRows.reason.message : 'Semester results could not be loaded.';
      }
      setErrors(failures);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [filters, retry, user.id]);

  const subjects = context?.subjects || [];
  const semesters = useMemo(() =>
    [...new Set(context?.enrollments.map((enrollment) => enrollment.semesterId).filter((value): value is string => Boolean(value)) || [])],
  [context]);
  const academicYears = useMemo(() =>
    [...new Set(context?.enrollments.map((enrollment) => enrollment.academicYearId).filter((value): value is string => Boolean(value)) || [])],
  [context]);
  const examinationTypes = useMemo(() =>
    [...new Set([...materials, ...papers, ...answerKeys]
      .map((document) => document.examinationType)
      .filter((value): value is string => Boolean(value)))],
  [materials, papers, answerKeys]);
  const visibleMaterials = materials.filter((document) => documentMatches(document, filters));
  const visiblePapers = papers.filter((document) => documentMatches(document, filters));
  const visibleAnswerKeys = answerKeys.filter((document) => documentMatches(document, filters));

  const handleDownload = async (kind: RepositoryKind, document: AcademicDocument) => {
    setDownloadError(null);
    try {
      const response = await api.getAcademicDocumentDownload(kind, document.id);
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'The academic document could not be downloaded.');
    }
  };

  const handleIndex = async (document: AcademicDocument) => {
    if (!document.documentId || !document.courseId) return;
    setDownloadError(null);
    setProcessingDocumentId(document.id);
    try {
      await api.processDocument(document.documentId, document.courseId);
      setMaterials((current) => current.map((item) =>
        item.id === document.id ? { ...item, ragReady: true } : item));
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'The educational document could not be indexed.');
    } finally {
      setProcessingDocumentId(null);
    }
  };

  if (isLoading && !context) {
    return (
      <section className="space-y-4" aria-label="Student academic records">
        <LoadingSkeleton className="h-24 w-full rounded-xl" />
        <LoadingSkeleton className="h-64 w-full rounded-xl" />
      </section>
    );
  }

  return (
    <section className="space-y-6 border-t border-[#E2E8F0] pt-6" aria-label="Student academic records">
      <div>
        <h2 className="text-sm font-semibold text-[#0F172A]">Academic Records & University Repository</h2>
        <p className="text-xs text-[#64748B] mt-1">
          Published university materials, previous papers, released official answer keys, and verified academic results.
        </p>
      </div>

      {errors.profile && (
        <ErrorState
          title="Academic records unavailable"
          message={errors.profile}
          onRetry={() => setRetry((attempt) => attempt + 1)}
        />
      )}
      {downloadError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{downloadError}</p>}

      <div className="flex flex-wrap gap-3">
        {([
          ['departmentId', 'Department', context?.departmentId ? [[context.departmentId, context.departmentId]] : []],
          ['regulationId', 'Regulation', context?.regulationId ? [[context.regulationId, context.regulationId]] : []],
          ['semesterId', 'Semester', semesters.map((value) => [value, value])],
          ['subjectId', 'Subject', subjects.map((subject) => [subject.id, `${subject.code} · ${subject.title}`])],
          ['academicYearId', 'Academic Year', academicYears.map((value) => [value, value])],
          ['examinationType', 'Examination Type', examinationTypes.map((value) => [value, value])],
        ] as [keyof AcademicFilters, string, string[][]][]).map(([field, label, options]) => (
          <label key={field} className="flex flex-col gap-1 text-[11px] text-[#64748B]">
            <span>{label}</span>
            <select
              value={filters[field] || ''}
              onChange={(event) => setFilters((current) => ({
                ...current,
                [field]: event.target.value || undefined,
              }))}
              className="text-xs bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[#0F172A]"
            >
              <option value="">All {label.toLowerCase()}s</option>
              {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>
        ))}
      </div>

      {repositories.map(({ kind, title, label }) => {
        const documents = kind === 'materials' ? visibleMaterials
          : kind === 'question-papers' ? visiblePapers : visibleAnswerKeys;
        const repository = kind === 'materials' ? 'materials'
          : kind === 'question-papers' ? 'question-papers' : 'answer-keys';
        return (
          <div key={kind} className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-[#0F172A]">{title}</h3>
              <p className="text-[11px] text-[#64748B] mt-0.5">{label}</p>
            </div>
            {errors[kind === 'materials' ? 'materials' : kind === 'question-papers' ? 'papers' : 'answerKeys']
              ? (
                <ErrorState
                  title="Repository unavailable"
                  message={errors[kind === 'materials' ? 'materials' : kind === 'question-papers' ? 'papers' : 'answerKeys']!}
                  onRetry={() => setRetry((attempt) => attempt + 1)}
                />
              ) : (
                <AcademicDocumentList
                  documents={documents}
                  repository={repository}
                  onDownload={handleDownload}
                  onIndex={handleIndex}
                  processingDocumentId={processingDocumentId}
                />
              )}
          </div>
        );
      })}

      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-[#0F172A]">Verified Subject-wise Marks</h3>
          <p className="text-[11px] text-[#64748B] mt-0.5">Only marks verified by authorized university staff are shown.</p>
        </div>
        {errors.marks ? (
          <ErrorState
            title="Verified marks unavailable"
            message={errors.marks}
            onRetry={() => setRetry((attempt) => attempt + 1)}
          />
        ) : marks.length === 0 ? (
          <EmptyState icon={<FileText className="w-6 h-6" />} title="No verified marks available" description="Verified marks will appear here after they are published to your student record." />
        ) : (
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden divide-y divide-[#E2E8F0]">
            {marks.map((mark) => {
              const subject = subjects.find((item) => item.id === mark.subjectId);
              return (
                <div key={mark.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-[#0F172A]">{subject ? `${subject.code} · ${subject.title}` : mark.subjectId}</span>
                  <span className="text-[#334155] tabular-nums">{mark.score} / {mark.maximumScore}</span>
                  <Badge variant="success">VERIFIED</Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-[#0F172A]">Semester Results</h3>
          <p className="text-[11px] text-[#64748B] mt-0.5">Official result records are shown only after verification.</p>
        </div>
        {errors.results ? (
          <ErrorState
            title="Semester results unavailable"
            message={errors.results}
            onRetry={() => setRetry((attempt) => attempt + 1)}
          />
        ) : results.length === 0 ? (
          <EmptyState icon={<FileText className="w-6 h-6" />} title="No verified semester results available" description="Published semester results will appear here after university verification." />
        ) : (
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden divide-y divide-[#E2E8F0]">
            {results.map((result) => (
              <div key={result.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-[#0F172A]">{result.academicYearId} · {result.semesterId}</span>
                <span className="text-[#334155]">{result.creditsEarned} credits · {result.resultStatus}</span>
                <Badge variant="success">VERIFIED</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-[#64748B]">
        Official university answer keys are distinct from AI-generated explanations. The AI Tutor does not publish or alter official academic records.
      </p>
    </section>
  );
};
