import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BookOpen, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

type AssignmentData = Awaited<ReturnType<typeof api.getAdminCourseAssignments>>;
type AcademicStructure = Awaited<ReturnType<typeof api.getAdminAcademicStructure>>;

export const AdminWorkspace: React.FC = () => {
  const { role } = useAuth();
  const [data, setData] = useState<AssignmentData>({ faculty: [], courses: [] });
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof api.getAdminInstitutionSetup>> | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getAdminOverview>> | null>(null);
  const [unassignedUsers, setUnassignedUsers] = useState<Array<{ id: string; email: string; role: string }>>([]);
  const [institutionStudents, setInstitutionStudents] = useState<Array<{
    id: string;
    email: string;
    isApproved: boolean | null;
    branchId: string | null;
  }>>([]);
  const [academicStructure, setAcademicStructure] = useState<AcademicStructure>({
    departments: [],
    branches: [],
  });
  const [selectedBranchByStudent, setSelectedBranchByStudent] = useState<Record<string, string>>({});
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [batchBranchId, setBatchBranchId] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [institutionCode, setInstitutionCode] = useState('');
  const [departmentCode, setDepartmentCode] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [branchDepartmentId, setBranchDepartmentId] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [selectedInstitutionUser, setSelectedInstitutionUser] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [courseBranchId, setCourseBranchId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const activeInstitutionId = setup?.institutionId || setup?.institutions[0]?.id || null;
  const loadAssignments = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const currentSetup = await api.getAdminInstitutionSetup();
      setSetup(currentSetup);
      const institutionId = currentSetup.institutionId || currentSetup.institutions[0]?.id;
      if (!institutionId) {
        setData({ faculty: [], courses: [] });
        setOverview(null);
        setInstitutionStudents([]);
        setUnassignedUsers([]);
        setAcademicStructure({ departments: [], branches: [] });
        return;
      }

      const [nextStructure, nextStudents, nextUnassignedUsers] = await Promise.all([
        api.getAdminAcademicStructure(institutionId),
        api.getInstitutionStudents(institutionId),
        api.getUnassignedInstitutionUsers(institutionId),
      ]);
      setAcademicStructure(nextStructure);
      setInstitutionStudents(nextStudents);
      setUnassignedUsers(nextUnassignedUsers);

      if (currentSetup.institutionId) {
        const [nextAssignments, nextOverview] = await Promise.all([
          api.getAdminCourseAssignments(),
          api.getAdminOverview(),
        ]);
        setData(nextAssignments);
        setOverview(nextOverview);
      } else {
        setData({ faculty: [], courses: [] });
        setOverview(null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Course assignments could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  if (role !== 'admin') {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card className="p-6 text-center space-y-3">
          <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto" />
          <h2 className="text-sm font-semibold text-slate-900">Administrator access required</h2>
        </Card>
      </div>
    );
  }

  const createCourse = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      const enrolledStudentCount = await api.createAdminCourse({
        code: courseCode.trim(),
        title: courseTitle.trim(),
        description: courseDescription.trim(),
        facultyId,
        branchId: courseBranchId,
      });
      setCourseCode('');
      setCourseTitle('');
      setCourseDescription('');
      setCourseBranchId('');
      setSuccessMessage(
        `Course created and assigned to faculty. ${enrolledStudentCount} student${enrolledStudentCount === 1 ? '' : 's'} enrolled from the selected branch.`,
      );
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Course could not be created.');
    } finally {
      setIsSaving(false);
    }
  };

  const createInstitution = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      await api.createAdminInstitution(institutionName.trim(), institutionCode.trim().toLowerCase());
      setInstitutionName('');
      setInstitutionCode('');
      setSuccessMessage('Institution created. Assign administrators and users explicitly below.');
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Institution could not be created.');
    } finally {
      setIsSaving(false);
    }
  };

  const assignInstitutionUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeInstitutionId || !selectedInstitutionUser) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      await api.assignUserToInstitution(activeInstitutionId, selectedInstitutionUser);
      setSelectedInstitutionUser('');
      setSuccessMessage('User assigned to the institution.');
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'User could not be assigned.');
    } finally {
      setIsSaving(false);
    }
  };

  const approveStudent = async (profileId: string) => {
    if (!activeInstitutionId) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      await api.approveStudentAccount(activeInstitutionId, profileId);
      setSuccessMessage('Student approved. An approval message is available in the student inbox after sign-in.');
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Student could not be approved.');
    } finally {
      setIsSaving(false);
    }
  };

  const createDepartment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeInstitutionId) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      await api.createAdminDepartment(activeInstitutionId, {
        code: departmentCode.trim(),
        name: departmentName.trim(),
      });
      setDepartmentCode('');
      setDepartmentName('');
      setSuccessMessage('Department created.');
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Department could not be created.');
    } finally {
      setIsSaving(false);
    }
  };

  const createBranch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeInstitutionId || !branchDepartmentId) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      await api.createAdminBranch(activeInstitutionId, branchDepartmentId, {
        code: branchCode.trim(),
        name: branchName.trim(),
      });
      setBranchCode('');
      setBranchName('');
      setSuccessMessage('Branch created.');
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Branch could not be created.');
    } finally {
      setIsSaving(false);
    }
  };

  const assignStudentBranch = async (studentId: string) => {
    if (!activeInstitutionId) return;
    const branchId = selectedBranchByStudent[studentId]
      ?? institutionStudents.find((student) => student.id === studentId)?.branchId
      ?? '';
    if (!branchId) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      const result = await api.assignStudentBranch(activeInstitutionId, studentId, branchId);
      setSelectedBranchByStudent((current) => {
        const next = { ...current };
        delete next[studentId];
        return next;
      });
      setSuccessMessage(
        `Student assigned to the selected branch. ${result.enrolledCourseCount} new course enrollment${result.enrolledCourseCount === 1 ? '' : 's'} created from ${result.branchCourseCount} branch course${result.branchCourseCount === 1 ? '' : 's'}.`,
      );
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Student branch assignment could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const assignSelectedStudentsBranch = async () => {
    if (!activeInstitutionId || !batchBranchId || selectedStudentIds.length === 0) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      const result = await api.assignStudentsBranch(
        activeInstitutionId,
        selectedStudentIds,
        batchBranchId,
      );
      setSelectedStudentIds([]);
      setBatchBranchId('');
      setSuccessMessage(
        `${result.assignedCount} student${result.assignedCount === 1 ? '' : 's'} assigned. ${result.enrolledCourseCount} new course enrollment${result.enrolledCourseCount === 1 ? '' : 's'} created from ${result.branchCourseCount} branch course${result.branchCourseCount === 1 ? '' : 's'}.`,
      );
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Student branch assignments could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const assignSelectedStudentsToCourse = async () => {
    if (!activeInstitutionId || !selectedCourseId || selectedStudentIds.length === 0) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      const result = await api.assignStudentsToCourse(
        activeInstitutionId,
        selectedCourseId,
        selectedStudentIds,
      );
      const course = data.courses.find((item) => item.id === selectedCourseId);
      setSuccessMessage(
        `${result.assignedCount} student${result.assignedCount === 1 ? '' : 's'} assigned to ${course?.code || 'the course'}; ${result.alreadyEnrolledCount} already had an enrollment. Existing enrollment statuses were not changed.`,
      );
      setSelectedStudentIds([]);
      setSelectedCourseId('');
      await loadAssignments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Students could not be assigned to the course.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudentIds((current) => current.includes(studentId)
      ? current.filter((id) => id !== studentId)
      : [...current, studentId]);
  };

  const allStudentsSelected = institutionStudents.length > 0
    && selectedStudentIds.length === institutionStudents.length;

  const updateAssignment = async (courseId: string, nextFacultyId: string) => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await api.assignCourseToFaculty(courseId, nextFacultyId || null);
      setData((current) => ({
        ...current,
        courses: current.courses.map((course) =>
          course.id === courseId ? { ...course, instructorId: nextFacultyId || null } : course
        ),
      }));
      setSuccessMessage('Course assignment updated.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Course assignment could not be updated.');
    }
  };

  const getBranchLabel = (branchId: string | null) => {
    const branch = academicStructure.branches.find((item) => item.id === branchId);
    if (!branch) return 'No branch assigned';
    const department = academicStructure.departments.find((item) => item.id === branch.department_id);
    return `${department?.code ? `${department.code} · ` : ''}${branch.code} · ${branch.name}`;
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Administrator</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Manage departments, classes, and courses</h1>
        <p className="mt-1 text-sm text-slate-600">Create your own department and class branches, assign students to their classes, and choose a faculty member and class for each course.</p>
      </header>

      {errorMessage && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{successMessage}</p>}

      {setup && !setup.institutionId && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Institution onboarding</h2>
            <p className="mt-1 text-sm text-slate-600">No institution is assigned to this administrator. Create the institution record first; no users or departments will be assigned automatically.</p>
          </div>
          <form onSubmit={createInstitution} className="grid gap-4 md:grid-cols-[1fr_180px_auto]">
            <label className="text-sm font-medium text-slate-700">Institution name<input value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} maxLength={200} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-slate-700">Code<input value={institutionCode} onChange={(event) => setInstitutionCode(event.target.value)} pattern="[a-z0-9][a-z0-9_-]{1,39}" required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <div className="flex items-end"><Button type="submit" variant="primary" isLoading={isSaving}>Create institution</Button></div>
          </form>
        </Card>
      )}

      {activeInstitutionId && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Departments and branches</h2>
            <p className="mt-1 text-sm text-slate-600">Create the departments and class branches used by your institution.</p>
          </div>
          <form onSubmit={createDepartment} className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
            <label className="text-sm font-medium text-slate-700">Department code
              <input value={departmentCode} onChange={(event) => setDepartmentCode(event.target.value)} maxLength={40} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm font-medium text-slate-700">Department name
              <input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} maxLength={200} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <div className="flex items-end"><Button type="submit" variant="primary" isLoading={isSaving}>Create department</Button></div>
          </form>
          <form onSubmit={createBranch} className="grid gap-3 border-t border-slate-200 pt-4 md:grid-cols-[1fr_180px_1fr_auto]">
            <label className="text-sm font-medium text-slate-700">Parent department
              <select value={branchDepartmentId} onChange={(event) => setBranchDepartmentId(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="">Select department</option>
                {academicStructure.departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">Branch code
              <input value={branchCode} onChange={(event) => setBranchCode(event.target.value)} maxLength={40} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm font-medium text-slate-700">Branch name
              <input value={branchName} onChange={(event) => setBranchName(event.target.value)} maxLength={200} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <div className="flex items-end"><Button type="submit" variant="primary" isLoading={isSaving} disabled={!academicStructure.departments.length}>Create branch</Button></div>
          </form>
          {academicStructure.departments.length > 0 && (
            <ul className="divide-y divide-slate-200 border-t border-slate-200">
              {academicStructure.departments.map((department) => (
                <li key={department.id} className="py-3">
                  <p className="text-sm font-semibold text-slate-900">{department.code} · {department.name}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {academicStructure.branches.filter((branch) => branch.department_id === department.id)
                      .map((branch) => `${branch.code} · ${branch.name}`).join(', ') || 'No branches yet'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {activeInstitutionId && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Assign institution users</h2>
            <p className="mt-1 text-sm text-slate-600">Assignments are explicit. An administrator remains restricted until assigned to this institution.</p>
          </div>
          <form onSubmit={assignInstitutionUser} className="flex flex-col gap-3 md:flex-row">
            <select value={selectedInstitutionUser} onChange={(event) => setSelectedInstitutionUser(event.target.value)} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="">Select an unassigned user</option>
              {unassignedUsers.map((user) => <option key={user.id} value={user.id}>{user.email} ({user.role})</option>)}
            </select>
            <Button type="submit" variant="primary" isLoading={isSaving} disabled={!selectedInstitutionUser}>Assign user</Button>
          </form>
        </Card>
      )}

      {activeInstitutionId && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Institution students</h2>
            <p className="mt-1 text-sm text-slate-600">Assigned students remain listed here. Approving a pending student enables sign-in and adds an approval message to their inbox.</p>
          </div>
          {isLoading ? <p role="status" className="text-sm text-slate-600">Loading institution students…</p>
            : institutionStudents.length === 0 ? <p className="text-sm text-slate-600">No students are assigned to this institution yet.</p>
              : (
                <>
                  {(academicStructure.branches.length > 0 || data.courses.length > 0) && (
                    <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-center">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          aria-label="Select all institution students"
                          checked={allStudentsSelected}
                          onChange={(event) => setSelectedStudentIds(
                            event.target.checked ? institutionStudents.map((student) => student.id) : [],
                          )}
                          className="rounded border-slate-300"
                        />
                        Select all students
                      </label>
                      <span className="text-sm text-slate-600">{selectedStudentIds.length} selected</span>
                      {academicStructure.branches.length > 0 && (
                        <>
                          <select
                            aria-label="Branch for selected students"
                            value={batchBranchId}
                            onChange={(event) => setBatchBranchId(event.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">Select branch</option>
                            {academicStructure.branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {academicStructure.departments.find((department) => department.id === branch.department_id)?.code || 'Department'} · {branch.code} · {branch.name}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="primary"
                            isLoading={isSaving}
                            disabled={selectedStudentIds.length === 0 || !batchBranchId}
                            onClick={() => void assignSelectedStudentsBranch()}
                          >
                            Assign selected students
                          </Button>
                        </>
                      )}
                      {data.courses.length > 0 && (
                        <>
                          <select
                            aria-label="Course for selected students"
                            value={selectedCourseId}
                            onChange={(event) => setSelectedCourseId(event.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">Select course</option>
                            {data.courses.map((course) => (
                              <option key={course.id} value={course.id}>{course.code} · {course.title}</option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="secondary"
                            isLoading={isSaving}
                            disabled={selectedStudentIds.length === 0 || !selectedCourseId}
                            onClick={() => void assignSelectedStudentsToCourse()}
                          >
                            Assign selected students to course
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  <ul className="divide-y divide-slate-200">
                  {institutionStudents.map((student) => (
                    <li key={student.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        {(academicStructure.branches.length > 0 || data.courses.length > 0) && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${student.email}`}
                            checked={selectedStudentIds.includes(student.id)}
                            onChange={() => toggleStudentSelection(student.id)}
                            className="mt-1 rounded border-slate-300"
                          />
                        )}
                        <div>
                          <p className="break-all text-sm text-slate-800">{student.email}</p>
                          <p className={`mt-1 text-xs ${student.isApproved ? 'text-green-700' : 'text-amber-700'}`}>
                            {student.isApproved === true ? 'Approved' : student.isApproved === false ? 'Pending approval' : 'Approval status unavailable'}
                          </p>
                          {student.branchId && (
                            <p className="mt-1 text-xs text-slate-600">
                              {getBranchLabel(student.branchId)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {student.isApproved === false && (
                          <Button type="button" variant="primary" isLoading={isSaving} onClick={() => void approveStudent(student.id)}>
                            Approve student
                          </Button>
                        )}
                        {academicStructure.branches.length > 0 && (
                          <>
                            <select
                              aria-label={`Branch for ${student.email}`}
                              value={selectedBranchByStudent[student.id] ?? student.branchId ?? ''}
                              onChange={(event) => setSelectedBranchByStudent((current) => ({ ...current, [student.id]: event.target.value }))}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            >
                              <option value="">Select branch</option>
                              {academicStructure.branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                  {academicStructure.departments.find((department) => department.id === branch.department_id)?.code || 'Department'} · {branch.code} · {branch.name}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="secondary"
                              isLoading={isSaving}
                              disabled={!selectedBranchByStudent[student.id] && !student.branchId}
                              onClick={() => void assignStudentBranch(student.id)}
                            >
                              Assign branch
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                  </ul>
                </>
              )}
        </Card>
      )}

      {overview && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Students', overview.students],
            ['Faculty', overview.faculty],
            ['Departments', overview.departments],
            ['Courses', overview.courses],
            ['Active enrollments', overview.activeEnrollments],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Plus size={17} /> Create a course</h2>
        {data.faculty.length === 0 && !isLoading && (
          <p className="text-sm text-amber-800">There are no faculty accounts yet. Faculty must create an account with an invite code before they can be assigned a course.</p>
        )}
        {academicStructure.branches.length === 0 && !isLoading && (
          <p className="text-sm text-amber-800">Create a department and class branch before creating a course.</p>
        )}
        <form onSubmit={createCourse} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Course code
            <input value={courseCode} onChange={(event) => setCourseCode(event.target.value)} maxLength={40} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="CS 101" />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Course title
            <input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} maxLength={200} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Introduction to Computer Science" />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
            Description
            <textarea value={courseDescription} onChange={(event) => setCourseDescription(event.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Optional course description" />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Assign to faculty
            <select value={facultyId} onChange={(event) => setFacultyId(event.target.value)} required disabled={data.faculty.length === 0} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="">Select faculty</option>
              {data.faculty.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.email}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Class branch
            <select value={courseBranchId} onChange={(event) => setCourseBranchId(event.target.value)} required disabled={academicStructure.branches.length === 0} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="">Select class branch</option>
              {academicStructure.branches.map((branch) => {
                const department = academicStructure.departments.find((item) => item.id === branch.department_id);
                return <option key={branch.id} value={branch.id}>{department?.code ?? 'Department'} · {branch.code} · {branch.name}</option>;
              })}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="primary" isLoading={isSaving} disabled={!data.faculty.length || !academicStructure.branches.length} icon={<Plus size={15} />}>Create and assign</Button>
          </div>
        </form>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><BookOpen size={17} /> Course assignments</h2>
          <Button type="button" variant="secondary" onClick={() => void loadAssignments()} isLoading={isLoading} icon={<RefreshCw size={14} />}>Refresh</Button>
        </div>
        {isLoading ? <p role="status" className="text-sm text-slate-600">Loading courses…</p>
          : data.courses.length === 0 ? <p className="text-sm text-slate-600">No courses have been created yet.</p>
            : (
              <div className="divide-y divide-slate-200">
                {data.courses.map((course) => (
                  <div key={course.id} className="grid gap-3 py-3 md:grid-cols-[1fr_1fr] md:items-center">
                    <div>
                      <p className="font-medium text-slate-900">{course.code} · {course.title}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {getBranchLabel(course.branchId)}
                      </p>
                    </div>
                    <label className="text-sm text-slate-600">
                      Assigned faculty
                      <select
                        aria-label={`Faculty for ${course.code}`}
                        value={course.instructorId || ''}
                        onChange={(event) => void updateAssignment(course.id, event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                      >
                        <option value="">Unassigned</option>
                        {data.faculty.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.email}</option>)}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            )}
      </Card>
    </div>
  );
};
