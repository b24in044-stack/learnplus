import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Pencil, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { Course, CourseMaterial, CourseMaterialCategory } from '../../types';
import { api } from '../../services/api';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useAuth } from '../../context/AuthContext';
import { StudentAcademicRepositories } from './StudentAcademicRepositories';

interface StudyMaterialsProps {
  courses: Course[];
}

const categories: { value: CourseMaterialCategory; label: string }[] = [
  { value: 'syllabus', label: 'Syllabus' },
  { value: 'pyq', label: 'Previous Year Question Papers (PYQs)' },
  { value: 'ppt', label: 'Presentations (PPTs)' },
  { value: 'course_pdf', label: 'Course Materials (PDFs)' },
  { value: 'other', label: 'Other Study Materials' },
];

const categoryLabel = (category: CourseMaterialCategory) =>
  categories.find((item) => item.value === category)?.label || 'Other Study Materials';

const formatBytes = (size: number) => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
};

const validFile = (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return ['pdf', 'txt', 'md'].includes(extension || '') && file.size > 0 && file.size <= 10 * 1024 * 1024;
};

export const StudyMaterials: React.FC<StudyMaterialsProps> = ({ courses }) => {
  const { user } = useAuth();
  const isFaculty = user.role === 'instructor';
  const isStudent = user.role === 'student';
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CourseMaterialCategory | ''>('');
  const [description, setDescription] = useState('');
  const [courseId, setCourseId] = useState(courses[0]?.id || '');
  const [file, setFile] = useState<File | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMaterial, setEditMaterial] = useState<CourseMaterial | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState<CourseMaterialCategory>('other');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<CourseMaterial | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [processingMaterialId, setProcessingMaterialId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!courses.some((course) => course.id === courseId)) {
      setCourseId(courses[0]?.id || '');
    }
  }, [courses, courseId]);

  const loadMaterials = async () => {
    setIsLoading(true);
    try {
      setMaterials(await api.getCourseMaterials());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Course materials could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadMaterials();
  }, [user.id]);

  const filteredMaterials = useMemo(() => materials.filter((material) => {
    if (categoryFilter !== 'all' && material.category !== categoryFilter) return false;
    if (courseFilter !== 'all' && material.courseId !== courseFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || [material.title, material.description, material.courseCode, material.uploadedBy]
      .some((value) => value.toLowerCase().includes(query));
  }), [materials, categoryFilter, courseFilter, search]);

  const submitUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFaculty || isDemoMode) return;
    if (!title.trim() || !category || !courseId || !file) {
      setError('Enter a title, select a category and course, and choose a file before uploading.');
      return;
    }
    if (!validFile(file)) {
      setError('Choose a non-empty PDF, TXT, or Markdown file no larger than 10 MB.');
      return;
    }
    setError(null);
    setIsUploading(true);
    try {
      await api.uploadCourseMaterial(courseId, file, {
        title: title.trim(),
        category,
        description: description.trim(),
      });
      setTitle('');
      setCategory('');
      setDescription('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await loadMaterials();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Course material upload failed. You can retry.');
    } finally {
      setIsUploading(false);
    }
  };

  const beginEdit = (material: CourseMaterial) => {
    setEditMaterial(material);
    setEditTitle(material.title);
    setEditDescription(material.description);
    setEditCategory(material.category);
    setError(null);
  };

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editMaterial || !editTitle.trim()) {
      setError('Document title is required.');
      return;
    }
    setIsSavingEdit(true);
    setError(null);
    try {
      const updated = await api.updateCourseMaterial(editMaterial.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        category: editCategory,
      });
      setEditMaterial(null);
      setMaterials((current) => current.map((item) => item.id === updated.id ? updated : item));
      await loadMaterials();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Course material could not be updated.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteMaterial = async () => {
    if (!materialToDelete) return;
    setIsDeleting(true);
    setError(null);
    try {
      await api.deleteCourseMaterial(materialToDelete.id);
      setMaterials((current) => current.filter((item) => item.id !== materialToDelete.id));
      setMaterialToDelete(null);
    } catch (deleteError) {
      await loadMaterials();
      setError(deleteError instanceof Error ? deleteError.message : 'Course material could not be deleted.');
    } finally {
      setIsDeleting(false);
    }
  };

  const downloadMaterial = async (material: CourseMaterial) => {
    setError(null);
    try {
      const download = await api.getCourseMaterialDownload(material.id);
      window.open(download.url, '_blank', 'noopener,noreferrer');
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Course material could not be opened.');
    }
  };

  const processMaterial = async (material: CourseMaterial) => {
    if (!material.documentId) return;
    setProcessingMaterialId(material.id);
    setError(null);
    try {
      await api.processDocument(material.documentId, material.courseId);
      await loadMaterials();
    } catch (processError) {
      await loadMaterials();
      setError(processError instanceof Error ? processError.message : 'AI processing could not be completed.');
    } finally {
      setProcessingMaterialId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Learning Materials</h1>
          <p className="mt-1 text-xs text-[#64748B]">
            {isFaculty
              ? 'Upload and manage course documents. Published materials are available to students enrolled in that course.'
              : 'Browse published materials for courses you are authorized to access.'}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadMaterials()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Refresh
        </Button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {isFaculty && (
        <form onSubmit={submitUpload} className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-xs">
          <h2 className="text-sm font-semibold text-[#0F172A]">Upload course material</h2>
          {isDemoMode && (
            <p role="status" className="text-xs text-amber-800">
              File storage is unavailable in demo mode. Sign in to the configured Supabase project to upload materials.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs font-medium text-[#334155]">
              Document title <span className="text-red-600">*</span>
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-[#334155]">
              What are you uploading? <span className="text-red-600">*</span>
              <select
                required
                value={category}
                onChange={(event) => setCategory(event.target.value as CourseMaterialCategory | '')}
                className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
              >
                <option value="" disabled>Select document type</option>
                {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-[#334155]">
              Course <span className="text-red-600">*</span>
              <select
                required
                value={courseId}
                onChange={(event) => setCourseId(event.target.value)}
                disabled={!courses.length}
                className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
              >
                <option value="">Select course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.title}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-[#334155]">
              Semester
              <input
                readOnly
                value={courses.find((course) => course.id === courseId)?.semesterId
                  ? 'Set by selected course'
                  : 'Not specified on the course'}
                className="w-full rounded-md border border-[#E2E8F0] bg-slate-50 px-3 py-2 text-xs text-[#64748B]"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-[#334155] md:col-span-2">
              Description
              <textarea
                maxLength={2000}
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-[#334155] md:col-span-2">
              File <span className="text-red-600">*</span>
              <input
                ref={fileInput}
                required
                type="file"
                accept=".pdf,.txt,.md"
                disabled={isUploading || isDemoMode}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="block w-full rounded-md border border-[#E2E8F0] bg-white p-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#4338CA]"
              />
              <span className="block font-normal text-[#64748B]">PDF, TXT, or Markdown; maximum 10 MB. Existing Storage limits apply.</span>
            </label>
          </div>
          {file && <p className="text-xs text-[#64748B]">Selected: {file.name} ({formatBytes(file.size)})</p>}
          <Button type="submit" isLoading={isUploading} disabled={isDemoMode || !courses.length} icon={<Upload className="h-3.5 w-3.5" />}>
            Upload File
          </Button>
        </form>
      )}

      <section className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="search"
            aria-label="Search materials"
            placeholder="Search title, course, uploader..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
          />
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
          >
            <option value="all">All categories</option>
            {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select
            aria-label="Filter by course"
            value={courseFilter}
            onChange={(event) => setCourseFilter(event.target.value)}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#4338CA]"
          >
            <option value="all">All courses</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}
          </select>
          <p className="self-center text-xs text-[#64748B]" aria-live="polite">
            Showing {filteredMaterials.length} material{filteredMaterials.length === 1 ? '' : 's'}
          </p>
        </div>

        {isLoading ? (
          <p role="status" className="rounded-lg border border-[#E2E8F0] bg-white p-5 text-xs text-[#64748B]">Loading course materials...</p>
        ) : filteredMaterials.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No course materials found"
            description={materials.length ? 'Try another category, course, or search term.' : 'Published course documents will appear here.'}
          />
        ) : (
          <div className="divide-y divide-[#E2E8F0] overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-xs">
            {filteredMaterials.map((material) => (
              <article key={material.id} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
                {editMaterial?.id === material.id ? (
                  <form onSubmit={saveEdit} className="grid w-full grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-xs text-[#334155]">
                      Title
                      <input required maxLength={200} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="w-full rounded border border-[#E2E8F0] px-2 py-1.5" />
                    </label>
                    <label className="space-y-1 text-xs text-[#334155]">
                      Category
                      <select value={editCategory} onChange={(event) => setEditCategory(event.target.value as CourseMaterialCategory)} className="w-full rounded border border-[#E2E8F0] bg-white px-2 py-1.5">
                        {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs text-[#334155] md:col-span-2">
                      Description
                      <textarea rows={2} maxLength={2000} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className="w-full rounded border border-[#E2E8F0] px-2 py-1.5" />
                    </label>
                    <div className="flex gap-2 md:col-span-2">
                      <Button type="submit" size="sm" isLoading={isSavingEdit}>Save changes</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditMaterial(null)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-[#4338CA]">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-xs font-semibold text-[#0F172A]">{material.title}</h2>
                        <p className="mt-1 text-[11px] text-[#64748B]">
                          {categoryLabel(material.category)} · {material.courseCode || courses.find((course) => course.id === material.courseId)?.code || 'Course'} · {material.fileType.toUpperCase()} · {formatBytes(material.fileSizeBytes)}
                        </p>
                        <p className="mt-1 text-[11px] text-[#64748B]">
                          Uploaded by {material.uploadedBy} · {formatDate(material.uploadedAt)}
                        </p>
                        {material.description && <p className="mt-1 text-xs text-[#475569]">{material.description}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {isFaculty && material.documentId && !material.ragReady && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          isLoading={processingMaterialId === material.id}
                          disabled={material.documentStatus === 'PROCESSING'}
                          onClick={() => void processMaterial(material)}
                          icon={<Sparkles className="h-3.5 w-3.5" />}
                        >
                          {material.documentStatus === 'PROCESSING' ? 'Processing...' : 'Process for Tutor'}
                        </Button>
                      )}
                      {isFaculty && material.ragReady && (
                        <span className="self-center text-[11px] font-medium text-green-700">AI Tutor ready</span>
                      )}
                      <Button type="button" size="sm" variant="secondary" onClick={() => void downloadMaterial(material)} icon={<Download className="h-3.5 w-3.5" />}>
                        View / Download
                      </Button>
                      {isFaculty && (
                        <>
                          <Button type="button" size="sm" variant="outline" onClick={() => beginEdit(material)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                          <Button type="button" size="sm" variant="danger" onClick={() => setMaterialToDelete(material)} icon={<Trash2 className="h-3.5 w-3.5" />}>Delete</Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog
        isOpen={Boolean(materialToDelete)}
        onClose={() => setMaterialToDelete(null)}
        title="Delete course material?"
        description="This removes the selected material and its stored file. This action cannot be undone."
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setMaterialToDelete(null)}>Cancel</Button>
            <Button type="button" variant="danger" size="sm" isLoading={isDeleting} onClick={() => void deleteMaterial()}>Delete material</Button>
          </>
        }
      >
        <p className="text-xs text-[#334155]">{materialToDelete?.title}</p>
      </Dialog>

      {isStudent && <StudentAcademicRepositories />}
    </div>
  );
};
