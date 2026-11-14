import {
  User,
  Course,
  StudyDocument,
  Assessment,
  Recommendation,
  WeakTopic,
  AnalyticsData,
  LearningPathNode,
  ChatSession,
  ChatMessage,
  StudyPlannerTask,
  CodingProblem,
  StudyPlannerSession
} from '../types';


export const INITIAL_STUDENT_USER: User = {
  id: 'usr_student_alex_01',
  name: 'Alex Chen',
  email: 'a.chen@university.edu',
  role: 'student',
  avatarUrl: '/src/assets/images/avatar_student_alex_1791648182699.jpg',
  department: 'Computer Science & Software Engineering',
  studentId: 'CS-2027-8492',
  enrolledSince: 'Fall 2024'
};

export const INITIAL_INSTRUCTOR_USER: User = {
  id: 'usr_inst_elena_02',
  name: 'Dr. Elena Rostova',
  email: 'elena.rostova@university.edu',
  role: 'instructor',
  avatarUrl: '/src/assets/images/avatar_professor_elena_1791648194876.jpg',
  department: 'Faculty of Computer Science',
  enrolledSince: 'Fall 2019'
};

export const INITIAL_COURSES: Course[] = [
  {
    id: 'course_cs201',
    code: 'CS 201',
    title: 'Data Structures & Algorithms',
    description: 'Fundamental abstractions, asymptotic runtime analysis, tree structures, balanced search trees, graph traversals, and dynamic programming.',
    instructor: 'Dr. Elena Rostova',
    credits: 4,
    progress: 68,
    enrolledStudents: 142,
    topicsCount: 8,
    materialsCount: 6,
    lastStudied: 'Yesterday, 4:20 PM',
    nextTopic: 'AVL Tree Rotations & Balance Invariants',
    topics: [
      { id: 'top_1', courseId: 'course_cs201', title: 'Asymptotic Analysis & Big-O Notation', order: 1, isCompleted: true, masteryScore: 92, prerequisites: [], estimatedMinutes: 45, resourcesCount: 3 },
      { id: 'top_2', courseId: 'course_cs201', title: 'Dynamic Arrays & Linked Lists', order: 2, isCompleted: true, masteryScore: 88, prerequisites: ['top_1'], estimatedMinutes: 60, resourcesCount: 2 },
      { id: 'top_3', courseId: 'course_cs201', title: 'Stacks, Queues, & Deques', order: 3, isCompleted: true, masteryScore: 95, prerequisites: ['top_2'], estimatedMinutes: 50, resourcesCount: 2 },
      { id: 'top_4', courseId: 'course_cs201', title: 'Binary Search Trees & Traversal Orders', order: 4, isCompleted: true, masteryScore: 81, prerequisites: ['top_3'], estimatedMinutes: 65, resourcesCount: 4 },
      { id: 'top_5', courseId: 'course_cs201', title: 'AVL Trees & Self-Balancing Invariants', order: 5, isCompleted: false, masteryScore: 48, prerequisites: ['top_4'], estimatedMinutes: 90, resourcesCount: 3 },
      { id: 'top_6', courseId: 'course_cs201', title: 'Priority Queues & Binary Heaps', order: 6, isCompleted: false, masteryScore: undefined, prerequisites: ['top_4'], estimatedMinutes: 75, resourcesCount: 2 },
      { id: 'top_7', courseId: 'course_cs201', title: 'Graph Representations & BFS/DFS', order: 7, isCompleted: false, masteryScore: undefined, prerequisites: ['top_3'], estimatedMinutes: 110, resourcesCount: 5 },
      { id: 'top_8', courseId: 'course_cs201', title: 'Dijkstra and Minimum Spanning Trees', order: 8, isCompleted: false, masteryScore: undefined, prerequisites: ['top_6', 'top_7'], estimatedMinutes: 120, resourcesCount: 3 }
    ]
  },
  {
    id: 'course_cs305',
    code: 'CS 305',
    title: 'Computer Systems & Architecture',
    description: 'Hardware-software interface, virtual memory, cache hierarchy, pipelining, race conditions, POSIX threads, and memory models.',
    instructor: 'Prof. Marcus Vance',
    credits: 4,
    progress: 44,
    enrolledStudents: 98,
    topicsCount: 6,
    materialsCount: 4,
    lastStudied: '3 days ago',
    nextTopic: 'Direct-Mapped vs Set-Associative Caching',
    topics: [
      { id: 'top_sys1', courseId: 'course_cs305', title: 'Bit Manipulation & Floating Point Representation', order: 1, isCompleted: true, masteryScore: 84, prerequisites: [], estimatedMinutes: 55, resourcesCount: 2 },
      { id: 'top_sys2', courseId: 'course_cs305', title: 'x86-64 Machine-Level Assembly Calling Conventions', order: 2, isCompleted: true, masteryScore: 76, prerequisites: ['top_sys1'], estimatedMinutes: 80, resourcesCount: 3 },
      { id: 'top_sys3', courseId: 'course_cs305', title: 'Cache Memory Hierarchy & Locality of Reference', order: 3, isCompleted: false, masteryScore: 52, prerequisites: ['top_sys2'], estimatedMinutes: 95, resourcesCount: 4 },
      { id: 'top_sys4', courseId: 'course_cs305', title: 'Virtual Memory & Page Table Translation', order: 4, isCompleted: false, masteryScore: undefined, prerequisites: ['top_sys3'], estimatedMinutes: 100, resourcesCount: 3 },
      { id: 'top_sys5', courseId: 'course_cs305', title: 'Exceptional Control Flow & Signals', order: 5, isCompleted: false, masteryScore: undefined, prerequisites: ['top_sys2'], estimatedMinutes: 70, resourcesCount: 2 },
      { id: 'top_sys6', courseId: 'course_cs305', title: 'Concurrency & POSIX Synchronization Primitives', order: 6, isCompleted: false, masteryScore: undefined, prerequisites: ['top_sys5'], estimatedMinutes: 110, resourcesCount: 3 }
    ]
  },
  {
    id: 'course_cs412',
    code: 'CS 412',
    title: 'Database Systems & Query Optimization',
    description: 'Relational algebra, SQL query execution engines, B+ tree indexing, transaction management, ACID guarantees, and 2-Phase Locking.',
    instructor: 'Dr. Sarah Lin',
    credits: 3,
    progress: 55,
    enrolledStudents: 115,
    topicsCount: 5,
    materialsCount: 5,
    lastStudied: 'Oct 8, 2026',
    nextTopic: 'B+ Tree Splitting & Merge Algorithm',
    topics: [
      { id: 'top_db1', courseId: 'course_cs412', title: 'Relational Model & Tuple Relational Calculus', order: 1, isCompleted: true, masteryScore: 90, prerequisites: [], estimatedMinutes: 50, resourcesCount: 2 },
      { id: 'top_db2', courseId: 'course_cs412', title: 'Buffer Pool Management & LRU-K Policies', order: 2, isCompleted: true, masteryScore: 82, prerequisites: ['top_db1'], estimatedMinutes: 65, resourcesCount: 3 },
      { id: 'top_db3', courseId: 'course_cs412', title: 'B+ Tree Index Concurrency & Node Split Mechanics', order: 3, isCompleted: false, masteryScore: 61, prerequisites: ['top_db2'], estimatedMinutes: 90, resourcesCount: 4 },
      { id: 'top_db4', courseId: 'course_cs412', title: 'Query Execution Plans & Hash Joins', order: 4, isCompleted: false, masteryScore: undefined, prerequisites: ['top_db3'], estimatedMinutes: 80, resourcesCount: 2 },
      { id: 'top_db5', courseId: 'course_cs412', title: 'Concurrency Control & Multi-Version (MVCC)', order: 5, isCompleted: false, masteryScore: undefined, prerequisites: ['top_db4'], estimatedMinutes: 105, resourcesCount: 3 }
    ]
  }
];

export const INITIAL_DOCUMENTS: StudyDocument[] = [
  {
    id: 'doc_1',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Lecture-06-Self-Balancing-Binary-Trees.pdf',
    fileType: 'pdf',
    fileSize: '3.4 MB',
    pages: 38,
    status: 'UPLOADED',
    uploadedAt: 'Oct 6, 2026',
    chunksCount: 0,
    vectorStatus: 'Demo sample metadata only; storage and document processing are unavailable.',
  },
  {
    id: 'doc_2',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Recitation-Graph-Traversals-BFS-DFS.pdf',
    fileType: 'pdf',
    fileSize: '1.8 MB',
    pages: 22,
    status: 'UPLOADED',
    uploadedAt: 'Oct 4, 2026',
    chunksCount: 0,
    vectorStatus: 'Demo sample metadata only; storage and document processing are unavailable.',
  },
  {
    id: 'doc_3',
    courseId: 'course_cs305',
    courseCode: 'CS 305',
    title: 'Chapter-09-Virtual-Memory-Architecture.pdf',
    fileType: 'pdf',
    fileSize: '4.1 MB',
    pages: 46,
    status: 'UPLOADED',
    uploadedAt: 'Oct 2, 2026',
    chunksCount: 0,
    vectorStatus: 'Demo sample metadata only; storage and document processing are unavailable.',
  },
  {
    id: 'doc_4',
    courseId: 'course_cs412',
    courseCode: 'CS 412',
    title: 'Database-Storage-Engines-BPlus-Trees.txt',
    fileType: 'text',
    fileSize: '620 KB',
    status: 'UPLOADED',
    uploadedAt: 'Sep 29, 2026',
    chunksCount: 0,
    vectorStatus: 'Demo sample metadata only; storage and document processing are unavailable.',
  },
  {
    id: 'doc_5',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Midterm-Study-Guide-Spring2026.pdf',
    fileType: 'pdf',
    fileSize: '2.1 MB',
    pages: 18,
    status: 'UPLOADED',
    uploadedAt: 'Today, 8:45 AM',
    chunksCount: 0,
    vectorStatus: 'Demo sample metadata only; storage and document processing are unavailable.',
  }
];

export const INITIAL_ASSESSMENTS: Assessment[] = [
  {
    id: 'asmt_avl_rotations',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Quiz 4: AVL Tree Balance & Rotations',
    topic: 'Self-Balancing Binary Trees',
    difficulty: 'Intermediate',
    questionCount: 5,
    durationMinutes: 15,
    passingScore: 70,
    attemptsCount: 2,
    bestScore: 60,
    questions: [
      {
        id: 'q1',
        topicTag: 'Balance Factor Calculation',
        questionText: 'Given a node N in an AVL tree, what is the valid range of the balance factor BF(N) = height(LeftSubtree) - height(RightSubtree) for the node to maintain the AVL invariant?',
        options: [
          'BF(N) must be strictly 0',
          'BF(N) ∈ {-1, 0, 1}',
          'BF(N) ∈ {-2, -1, 0, 1, 2}',
          'BF(N) must be >= 0'
        ],
        correctOptionIndex: 1,
        explanation: 'By definition of an AVL tree, every node must satisfy the height balance property: the heights of its left and right subtrees differ by at most 1, meaning BF(N) must be in {-1, 0, 1}. If |BF(N)| >= 2, a rotation is required.'
      },
      {
        id: 'q2',
        topicTag: 'Rotation Type Identification',
        questionText: 'An insertion occurs into the right subtree of the left child of an unbalanced node. Which rotation sequence is required to restore AVL balance?',
        options: [
          'Single Left Rotation (L)',
          'Single Right Rotation (R)',
          'Double Left-Right Rotation (LR)',
          'Double Right-Left Rotation (RL)'
        ],
        correctOptionIndex: 2,
        explanation: 'When an insertion is made into the inside child (right subtree of the left child, creating a "knee" or zigzag shape), a Left-Right (LR) double rotation is mandatory. The first rotation is a left rotation on the left child, followed by a right rotation on the root.'
      },
      {
        id: 'q3',
        topicTag: 'Time Complexity',
        questionText: 'What is the worst-case time complexity of rebalancing an AVL tree following a single node deletion?',
        options: [
          'O(1) rotations total',
          'O(log n) rotations in the worst case',
          'O(n) rotations',
          'O(n log n)'
        ],
        correctOptionIndex: 1,
        explanation: 'Unlike insertion (which requires at most two rotations—either a single or double rotation—O(1) rotations), deletion in an AVL tree can cause a cascade of height decreases along the path to the root, requiring up to O(log n) rotations.'
      },
      {
        id: 'q4',
        topicTag: 'Tree Invariants',
        codeSnippet: `// Balance factor definition
int balanceFactor(Node* node) {
    if (node == nullptr) return 0;
    return height(node->left) - height(node->right);
}`,
        questionText: 'If balanceFactor(A) == +2 and balanceFactor(A->left) == +1, which single rotation immediately restores balance to node A?',
        options: [
          'Right rotation on node A',
          'Left rotation on node A',
          'Left rotation on node A->left',
          'Right rotation on node A->left'
        ],
        correctOptionIndex: 0,
        explanation: 'When BF(A) is +2 and BF(A->left) is +1 (both signs positive), this is the classic Left-Left (LL) case. A single Right rotation centered on node A restores balance in O(1) time.'
      },
      {
        id: 'q5',
        topicTag: 'Height Upper Bound',
        questionText: 'If an AVL tree has height h = 4 (counting edges, single root has height 0), what is the minimum number of nodes N(h) it can contain?',
        options: [
          '4 nodes',
          '7 nodes',
          '12 nodes',
          '15 nodes'
        ],
        correctOptionIndex: 2,
        explanation: 'The minimum number of nodes in an AVL tree of height h follows the recurrence N(h) = N(h-1) + N(h-2) + 1, with N(0)=1, N(1)=2. Calculating: N(2) = 2+1+1 = 4; N(3) = 4+2+1 = 7; N(4) = 7+4+1 = 12 nodes (Fibonacci trees).'
      }
    ]
  },
  {
    id: 'asmt_sys_caching',
    courseId: 'course_cs305',
    courseCode: 'CS 305',
    title: 'Checkpoint: Cache Locality & Hierarchy',
    topic: 'Memory Hierarchy',
    difficulty: 'Intermediate',
    questionCount: 4,
    durationMinutes: 12,
    passingScore: 75,
    attemptsCount: 1,
    bestScore: 75,
    questions: [
      {
        id: 'q_c1',
        topicTag: 'Locality of Reference',
        questionText: 'Which type of locality is primarily exploited when a CPU fetches an entire 64-byte cache line upon accessing a single 4-byte integer in a contiguous array?',
        options: [
          'Temporal locality',
          'Spatial locality',
          'Associative locality',
          'Virtual locality'
        ],
        correctOptionIndex: 1,
        explanation: 'Spatial locality states that items with nearby memory addresses tend to be referenced close together in time. Loading contiguous bytes in a cache block exploits spatial locality directly.'
      },
      {
        id: 'q_c2',
        topicTag: 'Cache Addressing',
        questionText: 'In a 64-bit architecture with a 32 KB 8-way set-associative cache and 64-byte block size, how many bits are used for the Block Offset and Set Index respectively?',
        options: [
          'Offset: 6 bits, Set Index: 6 bits',
          'Offset: 6 bits, Set Index: 8 bits',
          'Offset: 8 bits, Set Index: 6 bits',
          'Offset: 5 bits, Set Index: 10 bits'
        ],
        correctOptionIndex: 0,
        explanation: 'Block size = 64 bytes = 2^6 bytes -> 6 offset bits. Cache size = 32 KB = 32,768 bytes. Each set contains 8 lines * 64 bytes = 512 bytes per set. Number of sets = 32,768 / 512 = 64 sets = 2^6 sets -> 6 set index bits.'
      },
      {
        id: 'q_c3',
        topicTag: 'Write Policies',
        questionText: 'What is the primary operational trade-off of a "Write-Through" cache policy compared to "Write-Back"?',
        options: [
          'Write-Through reduces bus traffic but requires complex dirty bits',
          'Write-Through provides simpler coherence and consistency but generates higher memory bus write traffic',
          'Write-Through is strictly faster for write-intensive workloads',
          'Write-Through eliminates read misses'
        ],
        correctOptionIndex: 1,
        explanation: 'In Write-Through, every cache write is simultaneously written to backing memory. This guarantees data consistency at the expense of higher memory bandwidth consumption.'
      },
      {
        id: 'q_c4',
        topicTag: 'Conflict Misses',
        questionText: 'Which cache structure completely eliminates conflict misses?',
        options: [
          'Direct-mapped cache',
          '2-way set-associative cache',
          '4-way set-associative cache',
          'Fully associative cache'
        ],
        correctOptionIndex: 3,
        explanation: 'In a fully associative cache, any memory block can be placed in any cache line. Therefore, conflict misses (where multiple blocks map to the same set) cannot occur; only compulsory and capacity misses remain.'
      }
    ]
  }
];

export const INITIAL_WEAK_TOPICS: WeakTopic[] = [
  {
    id: 'weak_1',
    concept: 'AVL Tree Double Rotations (LR & RL)',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    performanceScore: 48,
    attempts: 4,
    suggestedAction: 'Practice diagnosing zigzag insertion paths and coordinate node pointer reassignment.',
    recommendedPracticeQuestion: 'Explain step-by-step why an insertion into the right subtree of the left child requires two rotations instead of one.'
  },
  {
    id: 'weak_2',
    concept: 'Virtual Memory Multi-Level Page Translation',
    courseId: 'course_cs305',
    courseCode: 'CS 305',
    performanceScore: 52,
    attempts: 3,
    suggestedAction: 'Review PML4 offset calculation and translation steps from Lecture 9.',
    recommendedPracticeQuestion: 'How does the MMU convert a 48-bit virtual address into a physical address when a TLB miss occurs?'
  },
  {
    id: 'weak_3',
    concept: 'B+ Tree Node Split & Key Promotion',
    courseId: 'course_cs412',
    courseCode: 'CS 412',
    performanceScore: 61,
    attempts: 2,
    suggestedAction: 'Review leaf node splitting vs internal node key promotion invariants.',
    recommendedPracticeQuestion: 'What is the difference between copying up a key in a leaf node split vs pushing up a key in an internal node split?'
  }
];

export const INITIAL_RECOMMENDATIONS: Recommendation[] = [
  {
    id: 'rec_1',
    topic: 'Mastering AVL Double Rotations with Visual Traces',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    courseTitle: 'Data Structures & Algorithms',
    reason: 'Identified as your lowest scoring concept (48% mastery on Quiz 4). 3 recent incorrect choices on LR balance restoration.',
    estimatedMinutes: 25,
    priority: 'high',
    type: 'revision'
  },
  {
    id: 'rec_2',
    topic: 'Set-Associative Cache Index & Tag Breakdown',
    courseId: 'course_cs305',
    courseCode: 'CS 305',
    courseTitle: 'Computer Systems & Architecture',
    reason: 'Upcoming assignment due in 3 days. Prerequisite concept for next module on Virtual Memory.',
    estimatedMinutes: 20,
    priority: 'medium',
    type: 'practice'
  },
  {
    id: 'rec_3',
    topic: 'Graph Traversal Cycle Detection Proofs',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    courseTitle: 'Data Structures & Algorithms',
    reason: 'Recommended extension based on strong performance (95%) in Stacks and Queues.',
    estimatedMinutes: 30,
    priority: 'low',
    type: 'deep_dive'
  }
];

export const INITIAL_ANALYTICS: AnalyticsData = {
  averageScore: 78.5,
  assessmentsCompleted: 7,
  enrolledCoursesCount: 3,
  conceptsMasteredCount: 12,
  totalConceptsCount: 19,
  weeklyActivity: [
    { day: 'Mon', date: 'Oct 04', minutes: 65, eventsCount: 4 },
    { day: 'Tue', date: 'Oct 05', minutes: 90, eventsCount: 6 },
    { day: 'Wed', date: 'Oct 06', minutes: 45, eventsCount: 3 },
    { day: 'Thu', date: 'Oct 07', minutes: 120, eventsCount: 8 },
    { day: 'Fri', date: 'Oct 08', minutes: 80, eventsCount: 5 },
    { day: 'Sat', date: 'Oct 09', minutes: 30, eventsCount: 2 },
    { day: 'Sun', date: 'Oct 10', minutes: 75, eventsCount: 5 }
  ],
  scoreProgression: [
    { date: 'Sep 15', score: 92, assessmentTitle: 'Quiz 1: Big-O & Asymptotic Bounds' },
    { date: 'Sep 22', score: 85, assessmentTitle: 'Quiz 2: Arrays & Linked Lists' },
    { date: 'Sep 28', score: 94, assessmentTitle: 'Quiz 3: Stacks & Queue Invariants' },
    { date: 'Oct 02', score: 75, assessmentTitle: 'Checkpoint: Cache Locality' },
    { date: 'Oct 05', score: 82, assessmentTitle: 'Quiz 1: Relational Algebra & Calculus' },
    { date: 'Oct 08', score: 60, assessmentTitle: 'Quiz 4: AVL Balance & Rotations' },
    { date: 'Oct 09', score: 70, assessmentTitle: 'Quiz 4 Retake: AVL Balance' }
  ],
  weakTopics: INITIAL_WEAK_TOPICS,
  conceptMasteryList: [
    { concept: 'Asymptotic Complexity Analysis', courseCode: 'CS 201', mastery: 94, totalAttempts: 12, status: 'Mastered' },
    { concept: 'Stack & Queue ADT Implementations', courseCode: 'CS 201', mastery: 95, totalAttempts: 8, status: 'Mastered' },
    { concept: 'Binary Search Tree Traversals', courseCode: 'CS 201', mastery: 81, totalAttempts: 6, status: 'Developing' },
    { concept: 'AVL Balance Factor & Rotations', courseCode: 'CS 201', mastery: 48, totalAttempts: 5, status: 'Needs Practice' },
    { concept: 'Cache Locality & Addressing', courseCode: 'CS 305', mastery: 75, totalAttempts: 4, status: 'Developing' },
    { concept: 'Virtual Memory Multi-Level Paging', courseCode: 'CS 305', mastery: 52, totalAttempts: 3, status: 'Needs Practice' },
    { concept: 'Relational Model & Tuples', courseCode: 'CS 412', mastery: 90, totalAttempts: 7, status: 'Mastered' },
    { concept: 'B+ Tree Concurrency & Splitting', courseCode: 'CS 412', mastery: 61, totalAttempts: 3, status: 'Needs Practice' }
  ]
};

export const INITIAL_LEARNING_PATH: LearningPathNode[] = [
  {
    id: 'lp_1',
    title: 'Asymptotic Runtime & Big-O Notation',
    sequenceNumber: 1,
    status: 'mastered',
    masteryScore: 94,
    prerequisites: [],
    estimatedMinutes: 45,
    relatedResources: ['Lecture-01-Complexity.pdf', 'CheatSheet-Orders-of-Growth.md'],
    whyNextReason: 'Foundational baseline for analyzing all subsequent data structures.',
    practicePrompt: 'Compare the growth rates of n log n, n^1.5, and 2^sqrt(log n).'
  },
  {
    id: 'lp_2',
    title: 'Linear Data Structures: Arrays & Linked Lists',
    sequenceNumber: 2,
    status: 'mastered',
    masteryScore: 88,
    prerequisites: ['lp_1'],
    estimatedMinutes: 60,
    relatedResources: ['Lecture-02-Pointers-Memory.pdf'],
    whyNextReason: 'Establishes memory layout and amortized time bounds.',
    practicePrompt: 'Write an in-place reversal of a singly linked list in O(n) time and O(1) space.'
  },
  {
    id: 'lp_3',
    title: 'Binary Search Trees & Traversal Properties',
    sequenceNumber: 3,
    status: 'mastered',
    masteryScore: 81,
    prerequisites: ['lp_2'],
    estimatedMinutes: 65,
    relatedResources: ['Lecture-05-BST-Fundamentals.pdf'],
    whyNextReason: 'Prerequisite structure before studying balanced tree invariants.',
    practicePrompt: 'Prove that an in-order traversal of a valid BST always yields sorted keys.'
  },
  {
    id: 'lp_4',
    title: 'AVL Trees & Self-Balancing Invariants',
    sequenceNumber: 4,
    status: 'in_progress',
    masteryScore: 48,
    prerequisites: ['lp_3'],
    estimatedMinutes: 90,
    relatedResources: ['Lecture-06-Self-Balancing-Binary-Trees.pdf', 'AVL-Visualizer-Interactive'],
    whyNextReason: 'Current focus area. Diagnostic assessment indicates gap in double rotations (LR/RL) when restoring the |BF| <= 1 invariant.',
    practicePrompt: 'Given an unbalanced node with BF = +2 and left child BF = -1, draw the intermediate and final trees after an LR rotation.'
  },
  {
    id: 'lp_5',
    title: 'Priority Queues & Binary Heaps',
    sequenceNumber: 5,
    status: 'locked',
    masteryScore: undefined,
    prerequisites: ['lp_3', 'lp_4'],
    estimatedMinutes: 75,
    relatedResources: ['Lecture-07-Heaps-and-HeapSort.pdf'],
    whyNextReason: 'Unlocks once AVL Tree invariants reach >= 75% mastery.',
    practicePrompt: 'Explain how swim/percolate-up maintains the min-heap order invariant in O(log n) time.'
  },
  {
    id: 'lp_6',
    title: 'Graph Traversal & Shortest Paths (Dijkstra)',
    sequenceNumber: 6,
    status: 'locked',
    masteryScore: undefined,
    prerequisites: ['lp_5'],
    estimatedMinutes: 120,
    relatedResources: ['Lecture-08-Graph-Traversals.pdf', 'Recitation-Graph-Traversals-BFS-DFS.pdf'],
    whyNextReason: 'Advanced algorithmic module combining priority queues and adjacency representations.',
    practicePrompt: 'Why does Dijkstra’s algorithm fail when edge weights are negative?'
  }
];

export const INITIAL_CHAT_SESSIONS: ChatSession[] = [];

export const INITIAL_CHAT_MESSAGES: Record<string, ChatMessage[]> = {
  session_avl_help: [
    {
      id: 'msg_1',
      sessionId: 'session_avl_help',
      role: 'user',
      content: 'I keep getting confused on Quiz 4 about when to use a Left-Right (LR) double rotation versus a single Right rotation in an AVL tree. Can you explain the intuition with an example?',
      timestamp: '9:15 AM'
    },
    {
      id: 'msg_2',
      sessionId: 'session_avl_help',
      role: 'assistant',
      content: `Let's break down the intuition between **Single Right Rotation (R)** versus **Left-Right Double Rotation (LR)**.

### 1. The Core Invariant
In an AVL tree, every node $N$ must satisfy:
$$\\text{Balance Factor } BF(N) = \\text{height}(\\text{left}) - \\text{height}(\\text{right}) \\in \\{-1, 0, 1\\}$$

When an insertion causes $BF(N) = +2$, the left side is too heavy. Now, **where** did the new node go?

---

### 2. The Straight Line (Left-Left Case) $\\rightarrow$ Single Right Rotation
If the insertion was into the **outer branch** (the left child's left subtree):
- Both $BF(N) = +2$ and $BF(\\text{left child}) = +1$ share the **same positive sign**.
- The tree forms a straight diagonal line ($A \\rightarrow B \\rightarrow C$).
- **Solution:** A single **Right Rotation** around $A$ pulls node $B$ up to become the new root. Node $A$ becomes $B$'s right child. All binary search tree order properties are preserved in $O(1)$ operations.

---

### 3. The "Knee" or Zigzag (Left-Right Case) $\\rightarrow$ Double Rotation
If the insertion was into the **inner branch** (the left child's right subtree):
- $BF(N) = +2$, but $BF(\\text{left child}) = -1$ (opposing signs!).
- The tree forms a "knee" or zigzag shape.
- If you tried a single right rotation here, the node that was too low simply swings over, and the tree remains unbalanced!

**The 2-step fix:**
1. **Left Rotation on the left child:** Straightens the zigzag into a straight Left-Left line.
2. **Right Rotation on the root:** Restores height balance.

\`\`\`text
       A (+2)                   A (+2)                 C (0)
      /                        /                      /     \\
     B (-1)   ==[Rotate B]==> C (+1)  ==[Rotate A]==> B (0)  A (0)
      \\      Left             /       Right
       C                     B
\`\`\`

Would you like me to generate a 3-question targeted drill so you can test your rotation diagnosis on fresh numbers?`,
      timestamp: '9:17 AM',
      citations: [
        {
          documentId: 'doc_1',
          documentTitle: 'Lecture-06-Self-Balancing-Binary-Trees.pdf',
          pageNumber: 14,
          section: 'Section 4: Double Rotations (LR & RL)',
          excerpt: 'When an insertion occurs in the inside subtree (right child of the left subtree), a single rotation fails to restore height balance because the critical node remains at depth h. A two-step transformation is required: first a left rotation on the left child, then a right rotation on the grandparent.',
          confidenceScore: 0.96
        }
      ],
      agentSteps: [
        { layerNumber: 1, layerName: 'Perception & Ingestion', description: 'Parsed academic query; identified core domain: AVL Tree Rotations & Invariants.', durationMs: 42, status: 'completed' },
        { layerNumber: 2, layerName: 'Memory & Context Framing', description: 'Retrieved student context (Alex Chen, scored 48% on AVL Quiz 4; weak topic recorded).', durationMs: 85, status: 'completed' },
        { layerNumber: 3, layerName: 'Planning & Pedagogical Strategy', description: 'Selected comparative visual explanation: straight line (LL) vs zigzag (LR) with ASCII tree diagram.', durationMs: 110, status: 'completed' },
        { layerNumber: 4, layerName: 'Execution & RAG Grounding', description: 'Vector match in Lecture-06-Self-Balancing-Binary-Trees.pdf (chunk 14, score: 0.96).', durationMs: 180, status: 'completed' },
        { layerNumber: 5, layerName: 'Formative Assessment Generator', description: 'Prepared diagnostic follow-up question for active recall verification.', durationMs: 65, status: 'completed' },
        { layerNumber: 6, layerName: 'Meta-Cognitive Self-Correction', description: 'Validated balance factor invariant math: verified BF(N) formulas and ASCII correctness.', durationMs: 38, status: 'completed' }
      ]
    }
  ],
  session_cache_mapping: [
    {
      id: 'msg_c1',
      sessionId: 'session_cache_mapping',
      role: 'user',
      content: 'Can you show me the step-by-step formula for partitioning a 64-bit address into Tag, Set Index, and Block Offset?',
      timestamp: 'Oct 08, 11:00 AM'
    },
    {
      id: 'msg_c2',
      sessionId: 'session_cache_mapping',
      role: 'assistant',
      content: `Here is the authoritative formula used in Computer Systems & Architecture:

Given:
- Physical Address width $= m$ bits (e.g. 64 bits)
- Cache capacity $= C$ bytes (e.g. 32 KB $= 2^{15}$ bytes)
- Block/line size $= B$ bytes (e.g. 64 bytes $= 2^6$ bytes)
- Associativity $= E$ ways (e.g. 8-way $= 2^3$ lines/set)

### Step 1: Block Offset ($b$ bits)
$$b = \\log_2(B) = \\log_2(64) = 6\\text{ bits}$$

### Step 2: Set Index ($s$ bits)
$$\\text{Number of sets } S = \\frac{C}{B \\times E} = \\frac{32768}{64 \\times 8} = \\frac{32768}{512} = 64 \\text{ sets}$$
$$s = \\log_2(S) = \\log_2(64) = 6\\text{ bits}$$

### Step 3: Tag ($t$ bits)
$$t = m - (s + b) = 64 - (6 + 6) = 52\\text{ bits}$$

The memory address layout is always strictly:
\`[ Tag: 52 bits | Set Index: 6 bits | Block Offset: 6 bits ]\``,
      timestamp: 'Oct 08, 11:02 AM',
      citations: [
        {
          documentId: 'doc_3',
          documentTitle: 'Chapter-09-Virtual-Memory-Architecture.pdf',
          pageNumber: 8,
          section: 'Section 2.1: Cache Address Breakdown',
          excerpt: 'A memory address of m bits is partitioned into three fields: t tag bits, s set index bits, and b block offset bits such that m = t + s + b.',
          confidenceScore: 0.98
        }
      ],
      agentSteps: [
        { layerNumber: 1, layerName: 'Perception & Ingestion', description: 'Extracted query parameters: cache capacity, block size, associativity.', durationMs: 35, status: 'completed' },
        { layerNumber: 2, layerName: 'Memory & Context Framing', description: 'Contextualized with CS 305 syllabus and recent cache quiz results.', durationMs: 60, status: 'completed' },
        { layerNumber: 3, layerName: 'Planning & Pedagogical Strategy', description: 'Structured step-by-step formula breakdown with worked example.', durationMs: 95, status: 'completed' },
        { layerNumber: 4, layerName: 'Execution & RAG Grounding', description: 'Retrieved Section 2.1 from Chapter-09 reference text.', durationMs: 140, status: 'completed' },
        { layerNumber: 5, layerName: 'Formative Assessment Generator', description: 'Formulated bit summation verification check: 52 + 6 + 6 = 64.', durationMs: 50, status: 'completed' },
        { layerNumber: 6, layerName: 'Meta-Cognitive Self-Correction', description: 'Self-corrected arithmetic: confirmed power of 2 factorization.', durationMs: 30, status: 'completed' }
      ]
    }
  ]
};

export const INITIAL_STUDY_TASKS: StudyPlannerTask[] = [
  {
    id: 'task_1',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Quiz 4: AVL Tree Balance & Rotations',
    dueDate: 'Tomorrow',
    dueTime: '11:59 PM',
    type: 'quiz',
    completed: false,
    priority: 'high'
  },
  {
    id: 'task_2',
    courseId: 'course_cs305',
    courseCode: 'CS 305',
    title: 'Lab 3: Cache Locality & Simulation Benchmark',
    dueDate: 'In 3 days',
    dueTime: '5:00 PM',
    type: 'assignment',
    completed: false,
    priority: 'high'
  },
  {
    id: 'task_3',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Review Lecture 06 slides with AI Tutor',
    dueDate: 'Today',
    dueTime: '8:00 PM',
    type: 'review',
    completed: true,
    priority: 'medium'
  },
  {
    id: 'task_4',
    courseId: 'course_cs412',
    courseCode: 'CS 412',
    title: 'Midterm Exam: Relational Calculus & B+ Trees',
    dueDate: 'Oct 18, 2026',
    dueTime: '10:00 AM',
    type: 'exam',
    completed: false,
    priority: 'high'
  }
];

export const INITIAL_PLANNER_SESSIONS: StudyPlannerSession[] = [
  {
    id: 'plan_sess_1',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'AVL Rotations & Balance Factor Proofs',
    date: '2026-10-10',
    startTime: '10:00',
    durationMinutes: 60,
    completed: true,
    notes: 'Reviewed LL and RR single rotations. Still confused about LR double rotation.',
    type: 'review'
  },
  {
    id: 'plan_sess_2',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Practice Diagnostic Quiz 4 on AVL Invariants',
    date: '2026-10-10',
    startTime: '14:30',
    durationMinutes: 45,
    completed: false,
    notes: 'Aiming for 85%+ to clear the remediation flag.',
    type: 'quiz_prep'
  },
  {
    id: 'plan_sess_3',
    courseId: 'course_cs305',
    courseCode: 'CS 305',
    title: 'Cache Simulation Lab Coding',
    date: '2026-10-11',
    startTime: '09:00',
    durationMinutes: 90,
    completed: false,
    notes: 'Implement direct-mapped tag extraction in C/Python.',
    type: 'assignment'
  },
  {
    id: 'plan_sess_4',
    courseId: 'course_cs412',
    courseCode: 'CS 412',
    title: 'B+ Tree Concurrency Reading & Slide Notes',
    date: '2026-10-12',
    startTime: '16:00',
    durationMinutes: 75,
    completed: false,
    notes: 'Study crabbing protocol for B+ tree latching.',
    type: 'lecture'
  }
];

export const INITIAL_CODING_PROBLEMS: CodingProblem[] = [
  {
    id: 'prob_avl_rot',
    title: 'AVL Tree: Implement Left Rotation (RR Imbalance)',
    courseCode: 'CS 201',
    topicTag: 'Self-Balancing Trees',
    difficulty: 'Medium',
    description: `When an insertion occurs in the right subtree of the right child of an AVL node, a Right-Right (RR) violation occurs with balance factor = -2.
    
Write a function \`left_rotate(node)\` that performs a single counter-clockwise rotation around the given node \`z\`, maintaining BST search properties, updating parent/child pointers, and recalculating tree heights.`,
    examples: [
      {
        input: 'Tree with root 10 -> right 20 -> right 30',
        output: 'Subtree with root 20, left child 10, right child 30',
        explanation: 'Node 20 is promoted to root, 10 becomes its left child.'
      }
    ],
    constraints: [
      'Subtree size n <= 10^4',
      'Time complexity must be O(1)',
      'Auxiliary space must be O(1)'
    ],
    starterCode: {
      python: `class AVLNode:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None
        self.height = 1

def left_rotate(z: AVLNode) -> AVLNode:
    """
    Performs a single left rotation around node z.
    Returns the new root of this subtree.
    """
    # TODO: Implement left rotation
    y = z.right
    T2 = y.left
    
    y.left = z
    z.right = T2
    
    # Update heights
    z.height = 1 + max(get_height(z.left), get_height(z.right))
    y.height = 1 + max(get_height(y.left), get_height(y.right))
    
    return y

def get_height(node):
    return node.height if node else 0
`,
      javascript: `function leftRotate(z) {
  // y is the right child of z
  const y = z.right;
  const T2 = y.left;

  // Perform rotation
  y.left = z;
  z.right = T2;

  // Update heights
  z.height = 1 + Math.max(getHeight(z.left), getHeight(z.right));
  y.height = 1 + Math.max(getHeight(y.left), getHeight(y.right));

  return y;
}

function getHeight(node) {
  return node ? node.height : 0;
}`
    },
    solutionTemplates: {
      python: `def left_rotate(z):\n    y = z.right\n    T2 = y.left\n    y.left = z\n    z.right = T2\n    z.height = 1 + max(get_height(z.left), get_height(z.right))\n    y.height = 1 + max(get_height(y.left), get_height(y.right))\n    return y`,
      javascript: `function leftRotate(z) {\n  const y = z.right;\n  const T2 = y.left;\n  y.left = z;\n  z.right = T2;\n  return y;\n}`
    },
    testCases: [
      {
        id: 'tc_1',
        input: 'z = Node(10), z.right = Node(20), z.right.right = Node(30)',
        expected: 'new_root.val == 20 && new_root.left.val == 10 && new_root.right.val == 30'
      },
      {
        id: 'tc_2',
        input: 'z with right child having both left and right subtrees',
        expected: 'T2 is correctly attached as right child of z'
      },
      {
        id: 'tc_3',
        input: 'Height recalculation check for root and children',
        expected: 'z.height == 1, y.height == 2',
        isHidden: true
      }
    ],
    hints: [
      'Remember: In a left rotation, node z becomes the LEFT child of its original right child y.',
      'Do not forget the orphan subtree: y.left must become z.right!',
      'Recalculate heights from the bottom up: first update z, then update y.'
    ]
  },
  {
    id: 'prob_two_sum',
    title: 'Optimal Two-Sum Hash Map Lookup',
    courseCode: 'CS 201',
    topicTag: 'Hash Tables & Complexity',
    difficulty: 'Easy',
    description: `Given an array of integers \`nums\` and an integer \`target\`, return the indices of the two numbers such that they add up to \`target\`.
    
You may assume each input has exactly one solution, and you may not use the same element twice. Aim for O(n) linear time complexity using a hash table.`,
    examples: [
      {
        input: 'nums = [2, 7, 11, 15], target = 9',
        output: '[0, 1]',
        explanation: 'nums[0] + nums[1] == 2 + 7 == 9, so return [0, 1].'
      }
    ],
    constraints: [
      '2 <= nums.length <= 10^4',
      '-10^9 <= nums[i] <= 10^9',
      'Target can be negative, zero, or positive'
    ],
    starterCode: {
      python: `def two_sum(nums: list[int], target: int) -> list[int]:
    """
    Find indices of two numbers that add up to target.
    Target complexity: O(n) time, O(n) space.
    """
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []
`,
      javascript: `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (seen.has(complement)) {
      return [seen.get(complement), i];
    }
    seen.set(nums[i], i);
  }
  return [];
}`
    },
    solutionTemplates: {
      python: `def two_sum(nums, target):\n    seen = {}\n    for i, num in enumerate(nums):\n        comp = target - num\n        if comp in seen:\n            return [seen[comp], i]\n        seen[num] = i\n    return []`,
      javascript: `function twoSum(nums, target) {\n  const map = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    if (map.has(target - nums[i])) return [map.get(target - nums[i]), i];\n    map.set(nums[i], i);\n  }\n  return [];\n}`
    },
    testCases: [
      {
        id: 'tc_1',
        input: 'nums = [2, 7, 11, 15], target = 9',
        expected: '[0, 1]'
      },
      {
        id: 'tc_2',
        input: 'nums = [3, 2, 4], target = 6',
        expected: '[1, 2]'
      },
      {
        id: 'tc_3',
        input: 'nums = [3, 3], target = 6',
        expected: '[0, 1]',
        isHidden: true
      }
    ],
    hints: [
      'Use a dictionary / hash map to store elements you have already inspected alongside their indices.',
      'For each element, check whether target - element exists in the hash table.'
    ]
  },
  {
    id: 'prob_cache_sim',
    title: 'Direct-Mapped Cache Address Parser',
    courseCode: 'CS 305',
    topicTag: 'Cache Hierarchy',
    difficulty: 'Medium',
    description: `In a 32-bit architecture with a direct-mapped cache of 64 cache lines and 32 bytes per cache block:
    
Write a parser \`parse_address(address_hex)\` that extracts:
1. Block Offset (bits 0 to 4: 5 bits since 2^5 = 32)
2. Set Index (bits 5 to 10: 6 bits since 2^6 = 64)
3. Tag (bits 11 to 31: 21 bits)

Return an object / dictionary containing the decimal values of offset, index, and tag.`,
    examples: [
      {
        input: 'address_hex = "0x00001A4C"',
        output: '{ "offset": 12, "index": 18, "tag": 3 }',
        explanation: '0x1A4C binary decomposition into offset (5 bits), index (6 bits), and tag (21 bits).'
      }
    ],
    constraints: [
      'Address is formatted as 32-bit hexadecimal string or integer',
      'All bit shifts must be unsigned'
    ],
    starterCode: {
      python: `def parse_cache_address(addr_hex: str) -> dict:
    addr = int(addr_hex, 16)
    
    # 32 bytes/block -> 5 bits offset
    offset = addr & 0x1F
    
    # 64 lines -> 6 bits index
    index = (addr >> 5) & 0x3F
    
    # Remaining 21 bits are tag
    tag = addr >> 11
    
    return {"offset": offset, "index": index, "tag": tag}
`,
      javascript: `function parseCacheAddress(addrHex) {
  const addr = parseInt(addrHex, 16);
  const offset = addr & 0x1F;
  const index = (addr >> 5) & 0x3F;
  const tag = (addr >>> 11);
  return { offset, index, tag };
}`
    },
    solutionTemplates: {
      python: `def parse_cache_address(addr_hex):\n    addr = int(addr_hex, 16)\n    return {"offset": addr & 0x1F, "index": (addr >> 5) & 0x3F, "tag": addr >> 11}`,
      javascript: `function parseCacheAddress(hex) {\n  const addr = parseInt(hex, 16);\n  return { offset: addr & 0x1F, index: (addr >> 5) & 0x3F, tag: addr >>> 11 };\n}`
    },
    testCases: [
      {
        id: 'tc_1',
        input: 'addr_hex = "0x00000000"',
        expected: 'offset: 0, index: 0, tag: 0'
      },
      {
        id: 'tc_2',
        input: 'addr_hex = "0x00001A4C"',
        expected: 'offset: 12, index: 18, tag: 3'
      }
    ],
    hints: [
      'Offset mask: (1 << 5) - 1 = 0x1F (31).',
      'Index mask: (1 << 6) - 1 = 0x3F (63).'
    ]
  }
];
