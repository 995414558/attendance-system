// Global variables
let faceMatcher = null;
let knownFaces = [];
let currentStream = null;
let isModelsLoaded = false;
let isAttendanceRunning = false;
let currentSessionId = null;
let currentSessionStartTime = null;

// Face tracking for sustained detection
let faceTracking = new Map(); // faceId -> {count, firstSeen, lastSeen}

// Class and course data
let classCourseData = [];

// Initialize the application
async function init() {
    try {
        // Load face-api.js models (loading overlay is shown by default)
        await loadModels();
        console.log('Face recognition models loaded successfully');

        // Load known faces from server
        await loadKnownFaces();

        // Show success message
        showMessage('系统初始化完成！', 'success');
    } catch (error) {
        console.error('Initialization error:', error);
        // Hide loading overlay and show error
        document.getElementById('loading-overlay').style.display = 'none';
        showMessage('系统初始化失败，请刷新页面重试', 'error');
    }
}

// Load face-api.js models
async function loadModels() {
    // Use local models from the weights directory served by our backend
    const MODEL_URL = '/weights/';
    const progressBar = document.getElementById('loading-progress');
    const overlay = document.getElementById('loading-overlay');

    try {
        // Update loading text
        overlay.querySelector('div').firstChild.textContent = '正在加载面部检测模型...';
        progressBar.style.width = '25%';

        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

        overlay.querySelector('div').firstChild.textContent = '正在加载面部特征点模型...';
        progressBar.style.width = '50%';

        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

        overlay.querySelector('div').firstChild.textContent = '正在加载面部识别模型...';
        progressBar.style.width = '75%';

        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        overlay.querySelector('div').firstChild.textContent = '模型加载完成！';
        progressBar.style.width = '100%';

        isModelsLoaded = true;

        // Hide loading overlay after a short delay
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 1000);

        console.log('All models loaded successfully from local server');
    } catch (error) {
        console.error('Error loading models:', error);
        overlay.querySelector('div').firstChild.textContent = '模型加载失败';
        overlay.querySelector('div').lastChild.textContent = '请检查后端服务器是否正常运行';

        // Show error details for debugging
        showMessage(`模型加载错误: ${error.message}`, 'error');
    }
}

// Load known faces from server
async function loadKnownFaces() {
    try {
        const response = await fetch('/api/faces');
        const data = await response.json();

        knownFaces = data.faces.map(face => ({
            id: face.id,
            label: `${face.class} - ${face.name} (${face.course})`,
            descriptors: JSON.parse(face.descriptors)
        }));

        // Create face matcher
        if (knownFaces.length > 0) {
            const labeledDescriptors = knownFaces.map(face =>
                new faceapi.LabeledFaceDescriptors(face.label, [new Float32Array(face.descriptors)])
            );
            faceMatcher = new faceapi.FaceMatcher(labeledDescriptors);
        }

        console.log(`Loaded ${knownFaces.length} known faces`);

        // Load class-course combinations for attendance page
        await loadClassCourseData();
    } catch (error) {
        console.error('Error loading known faces:', error);
    }
}

// Load class and course combinations
async function loadClassCourseData() {
    try {
        const response = await fetch('/api/attendance/classes-courses');
        const data = await response.json();
        classCourseData = data.combinations;

        // Populate class dropdown
        populateClassDropdown();

        console.log(`Loaded ${classCourseData.length} class-course combinations`);
    } catch (error) {
        console.error('Error loading class-course data:', error);
    }
}

// Populate class dropdown
function populateClassDropdown() {
    const classSelect = document.getElementById('class-select');
    const uniqueClasses = [...new Set(classCourseData.map(item => item.class_name))];

    classSelect.innerHTML = '<option value="">Select Class</option>';
    uniqueClasses.forEach(className => {
        const option = document.createElement('option');
        option.value = className;
        option.textContent = className;
        classSelect.appendChild(option);
    });
}

// Update course options based on selected class
function updateCourseOptions() {
    const classSelect = document.getElementById('class-select');
    const courseSelect = document.getElementById('course-select');
    const selectedClass = classSelect.value;

    courseSelect.innerHTML = '<option value="">Select Course</option>';

    if (selectedClass) {
        const coursesForClass = classCourseData
            .filter(item => item.class_name === selectedClass)
            .map(item => item.course_name);

        const uniqueCourses = [...new Set(coursesForClass)];
        uniqueCourses.forEach(courseName => {
            const option = document.createElement('option');
            option.value = courseName;
            option.textContent = courseName;
            courseSelect.appendChild(option);
        });
    }
}

// Page navigation
function showPage(pageName) {
    // Stop attendance if switching away from attendance page
    if (pageName !== 'attendance' && isAttendanceRunning) {
        stopAttendance();
    }

    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.style.display = 'none');

    // Map page names to actual div IDs
    const pageMap = {
        'register': 'register-page',
        'attendance': 'attendance-page',
        'batch': 'batch-page',
        'reports': 'reports-page',
        'statistics': 'statistics-page',
        'data': 'data-page'
    };

    const actualPageId = pageMap[pageName];
    if (actualPageId) {
        const pageElement = document.getElementById(actualPageId);
        if (pageElement) {
            pageElement.style.display = 'block';

            // Load data for specific pages
            if (pageName === 'reports') {
                loadSessionsForReport();
            } else if (pageName === 'attendance') {
                // Refresh class-course data when entering attendance page
                loadClassCourseData();
            } else if (pageName === 'statistics') {
                // Load statistics data when entering statistics page
                loadOverallStats();
                loadCourseStats();
                loadClassStats();
                loadStudentStats();
                hideLegacyStatisticsBlocks();
            }
        } else {
            console.error(`Page element with ID '${actualPageId}' not found`);
        }
    } else {
        console.error(`Unknown page name: ${pageName}`);
    }
}

// Webcam registration functions
async function startWebcamRegistration() {
    try {
        const video = document.getElementById('registration-video');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        currentStream = stream;

        document.getElementById('capture-btn').style.display = 'block';
        showMessage('摄像头已启动，请面对镜头', 'info');
    } catch (error) {
        console.error('Error accessing webcam:', error);
        showMessage('无法访问摄像头，请检查权限', 'error');
    }
}

async function captureFace() {
    if (!isModelsLoaded) {
        showMessage('模型尚未加载完成，请稍候', 'warning');
        return;
    }

    const video = document.getElementById('registration-video');
    const canvas = document.getElementById('registration-canvas');

    try {
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (detection) {
            // Draw detection on canvas
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            faceapi.matchDimensions(canvas, displaySize);

            const resizedDetection = faceapi.resizeResults(detection, displaySize);
            const ctx = canvas.getContext('2d');

            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw the video frame on canvas first
            ctx.drawImage(video, 0, 0, displaySize.width, displaySize.height);

            // Draw detection box
            faceapi.draw.drawDetections(canvas, [resizedDetection]);

            // Make sure canvas is visible
            canvas.style.display = 'block';
            canvas.style.border = '2px solid #4CAF50';

            showMessage('人脸捕获成功！正在注册...', 'success');

            // Register the face
            await registerFace(detection.descriptor);
        } else {
            showMessage('未检测到人脸，请调整位置后重试', 'warning');
        }
    } catch (error) {
        console.error('Error capturing face:', error);
        showMessage('人脸捕获失败，请重试', 'error');
    }
}

// Register face from image upload
async function registerFromImage() {
    const fileInput = document.getElementById('image-upload');
    const file = fileInput.files[0];

    if (!file) {
        showMessage('请选择一张图片', 'warning');
        return;
    }

    if (!isModelsLoaded) {
        showMessage('模型尚未加载完成，请稍候', 'warning');
        return;
    }

    try {
        const image = await faceapi.bufferToImage(file);
        const detection = await faceapi.detectSingleFace(image, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (detection) {
            await registerFace(detection.descriptor);
        } else {
            showMessage('图片中未检测到人脸，请选择其他图片', 'warning');
        }
    } catch (error) {
        console.error('Error processing image:', error);
        showMessage('图片处理失败，请重试', 'error');
    }
}

// Register face with server
async function registerFace(descriptor) {
    const className = document.getElementById('student-class').value.trim();
    const name = document.getElementById('student-name').value.trim();
    const course = document.getElementById('student-course').value.trim();

    if (!className || !name || !course) {
        showMessage('请填写完整的学生信息', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/faces', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                label: `${className}-${name}-${course}`,
                descriptors: Array.from(descriptor),
                class: className,
                name: name,
                course: course
            })
        });

        if (response.ok) {
            showMessage('学生注册成功！', 'success');
            await loadKnownFaces(); // Reload faces
            // Clear form
            document.getElementById('student-class').value = '';
            document.getElementById('student-name').value = '';
            document.getElementById('student-course').value = '';
        } else {
            showMessage('注册失败，请重试', 'error');
        }
    } catch (error) {
        console.error('Error registering face:', error);
        showMessage('网络错误，请重试', 'error');
    }
}

// Attendance functions
async function startAttendance() {
    if (isAttendanceRunning) {
        showMessage('考勤会话已在运行中，请先停止当前会话', 'warning');
        return;
    }

    const classSelect = document.getElementById('class-select');
    const courseSelect = document.getElementById('course-select');

    const selectedClass = classSelect.value;
    const selectedCourse = courseSelect.value;

    if (!selectedClass || !selectedCourse) {
        showMessage('请选择班级和课程', 'warning');
        return;
    }

    if (!isModelsLoaded) {
        showMessage('模型尚未加载完成，请稍候', 'warning');
        return;
    }

    if (!faceMatcher) {
        showMessage('没有注册的学生面部数据，请先注册学生', 'warning');
        console.log('[考勤启动失败] faceMatcher 未初始化');
        return;
    }

    if (knownFaces.length === 0) {
        showMessage('没有注册的学生面部数据，请先注册学生', 'warning');
        console.log('[考勤启动失败] knownFaces 为空');
        return;
    }

    try {
        // First, check if we have camera permission
        console.log('[考勤启动] 检查摄像头权限...');

        // Test camera access first
        const testStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 640,
                height: 480,
                facingMode: 'user'
            }
        });

        // Stop test stream immediately
        testStream.getTracks().forEach(track => track.stop());
        console.log('[考勤启动] 摄像头权限检查通过');

        // Create session in database
        const startTime = new Date().toISOString();
        const response = await fetch('/api/attendance/sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                class_name: selectedClass,
                course_name: selectedCourse,
                start_time: startTime
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to create session: ${errorData.error || response.statusText}`);
        }

        const sessionData = await response.json();

        // Check if there's a duplicate session
        if (sessionData.duplicate) {
          const userChoice = confirm(sessionData.message + '\n\n点击"确定"覆盖上一次记录，点击"取消"取消操作。');

          if (userChoice) {
            // Override the duplicate session
            const overrideResponse = await fetch('/api/attendance/sessions/override', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                existing_session_id: sessionData.existing_session.id,
                new_session_data: {
                  class_name: selectedClass,
                  course_name: selectedCourse,
                  start_time: startTime
                }
              })
            });

            if (!overrideResponse.ok) {
              throw new Error('Failed to override session');
            }

            const overrideData = await overrideResponse.json();
            currentSessionId = overrideData.id;
            showMessage(overrideData.message, 'warning');
          } else {
            // User cancelled, don't start attendance
            return;
          }
        } else {
          currentSessionId = sessionData.id;
        }

        currentSessionStartTime = startTime;
        console.log(`[考勤启动] 会话创建成功: ${currentSessionId}`);

        // Update UI
        const sessionDisplay = document.getElementById('current-session-display');
        const sessionInfo = document.getElementById('current-session-info');
        sessionDisplay.textContent = `${selectedClass} - ${selectedCourse}`;
        sessionInfo.style.display = 'block';

        // Start video stream
        const video = document.getElementById('attendance-video');
        const canvas = document.getElementById('attendance-canvas');

        // Stop any existing stream
        stopWebcam();

        console.log('[考勤启动] 启动视频流...');
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 640,
                height: 480,
                facingMode: 'user'
            }
        });

        video.srcObject = stream;
        currentStream = stream;

        console.log('[考勤启动] 等待视频就绪...');
        // Wait for video to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Video loading timeout'));
            }, 10000); // 10 second timeout

            video.onloadedmetadata = () => {
                clearTimeout(timeout);
                video.play().then(resolve).catch(reject);
            };

            video.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Video loading failed'));
            };
        });

        console.log('[考勤启动] 视频流启动成功');
        console.log(`[考勤启动] 已加载 ${knownFaces.length} 个已注册面部`);

        // Update camera status to granted
        updateCameraStatus('granted');

        // Clear previous canvas
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Set attendance running flag
        isAttendanceRunning = true;

        console.log('[考勤启动] 开始面部检测循环...');

        // Show status indicator
        const statusDiv = document.getElementById('attendance-status');
        const statusText = document.getElementById('status-text');
        statusText.textContent = '考勤系统运行中...';
        statusDiv.style.display = 'block';

        // Start face detection loop
        detectFacesForAttendance(currentSessionId);

        showMessage('考勤系统已启动，开始检测面部...', 'success');

    } catch (error) {
        console.error('Error starting attendance:', error);

        // Update camera status indicator
        updateCameraStatus('denied');

        // Provide specific error messages based on error type
        let errorMessage = '无法启动考勤系统';
        let errorDetails = '';

        if (error.name === 'NotAllowedError' || error.message.includes('permission')) {
            errorMessage = '摄像头权限被拒绝';
            errorDetails = '请在浏览器地址栏点击摄像头图标允许访问，或刷新页面重试';
        } else if (error.name === 'NotFoundError') {
            errorMessage = '未找到摄像头设备';
            errorDetails = '请确保摄像头已连接并正常工作';
        } else if (error.name === 'NotReadableError') {
            errorMessage = '摄像头被其他应用占用';
            errorDetails = '请关闭其他使用摄像头的应用后重试';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage = '摄像头不支持请求的配置';
            errorDetails = '系统将尝试使用默认摄像头设置';
        } else if (error.message.includes('timeout')) {
            errorMessage = '摄像头启动超时';
            errorDetails = '请检查摄像头连接并重试';
        } else {
            errorDetails = error.message;
        }

        showMessage(`${errorMessage}: ${errorDetails}`, 'error');

        // Reset any partial state
        stopWebcam();
        isAttendanceRunning = false;
        currentSessionId = null;
        currentSessionStartTime = null;
    }
}

async function detectFacesForAttendance(sessionId) {
    const video = document.getElementById('attendance-video');
    const canvas = document.getElementById('attendance-canvas');

    console.log(`[检测循环] 开始检测会话: ${sessionId}`);

    // Check if video is ready and has valid dimensions
    if (!video || !video.videoWidth || !video.videoHeight) {
        console.log(`[检测循环] 视频未就绪，${video ? '宽:' + video.videoWidth + ' 高:' + video.videoHeight : 'video对象不存在'}`);
        // Video not ready yet, try again in 500ms
        setTimeout(() => detectFacesForAttendance(sessionId), 500);
        return;
    }

    // Check if we're still in attendance mode (video should be playing)
    if (video.paused || video.ended || !currentStream || !isAttendanceRunning) {
        console.log(`[检测循环] 检测停止 - 暂停:${video.paused} 结束:${video.ended} 流:${!!currentStream} 运行中:${isAttendanceRunning}`);
        return;
    }

    console.log(`[检测循环] 视频状态正常，开始面部检测`);

    try {
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptors();

        console.log(`[考勤检测] 检测到 ${detections.length} 张面部`);
        console.log(`[考勤状态] faceMatcher: ${faceMatcher ? '已初始化' : '未初始化'}`);
        console.log(`[考勤状态] knownFaces: ${knownFaces.length} 个已注册面部`);

        // Update status indicator
        const statusText = document.getElementById('status-text');
        if (statusText) {
            statusText.textContent = `检测中... 发现 ${detections.length} 张面部`;
        }

        const currentTime = Date.now();

        // Process detections with sustained tracking
        for (const detection of detections) {
            if (faceMatcher) {
                const match = faceMatcher.findBestMatch(detection.descriptor);
                console.log(`[面部匹配] ${match.label}, 距离: ${match.distance.toFixed(3)}`);

                // Higher confidence threshold (0.7) and sustained detection
                if (match.distance < 0.7) {
                    const face = knownFaces.find(f => f.label === match.label);
                    if (face) {
                        console.log(`[匹配成功] 找到注册面部: ${face.label}`);
                        await trackFaceForAttendance(face.id, match.label, sessionId, currentTime);
                    } else {
                        console.log(`[匹配失败] 未找到对应的注册面部数据`);
                    }
                } else {
                    console.log(`[相似度不足] 距离 ${match.distance.toFixed(3)} > 0.7`);
                }
            } else {
                console.log(`[错误] faceMatcher 未初始化`);
            }
        }

        // Clean up old face tracking data (faces not seen for 3 seconds)
        for (const [faceId, tracking] of faceTracking.entries()) {
            if (currentTime - tracking.lastSeen > 3000) {
                faceTracking.delete(faceId);
            }
        }

        // Draw detections
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);

        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw video frame first
        ctx.drawImage(video, 0, 0, displaySize.width, displaySize.height);

        // Draw detection boxes
        faceapi.draw.drawDetections(canvas, resizedDetections);

        // Make sure canvas is visible
        canvas.style.display = 'block';

    } catch (error) {
        console.error('Error in face detection:', error);
    }

    // Continue detection loop - use shorter interval for more responsive detection
    setTimeout(() => detectFacesForAttendance(sessionId), 300);
}

// Track recorded attendances to prevent duplicates
let recordedAttendances = new Set();

// Track face for sustained attendance recording
async function trackFaceForAttendance(faceId, faceLabel, sessionId, currentTime) {
    const attendanceKey = `${faceId}-${sessionId}`;

    console.log(`[面部跟踪] 跟踪面部: ${faceLabel} (ID: ${faceId})`);

    // Check if already recorded in this session
    if (recordedAttendances.has(attendanceKey)) {
        console.log(`[面部跟踪] ${faceLabel} 已在会话 ${sessionId} 中记录，跳过`);
        return; // Already recorded, skip
    }

    // Get or create tracking data for this face
    let tracking = faceTracking.get(faceId);
    if (!tracking) {
        tracking = {
            count: 0,
            firstSeen: currentTime,
            lastSeen: currentTime,
            sustainedStart: null
        };
        faceTracking.set(faceId, tracking);
        console.log(`[面部跟踪] 创建新的跟踪记录: ${faceLabel}`);
    }

    // Update tracking data
    tracking.count++;
    tracking.lastSeen = currentTime;

    // Check for sustained presence (1 second = 1000ms)
    const sustainedDuration = 1000; // 1 second
    const timeSinceFirstSeen = currentTime - tracking.firstSeen;

    console.log(`[面部跟踪] ${faceLabel} - 持续时间: ${(timeSinceFirstSeen/1000).toFixed(1)}秒, 检测次数: ${tracking.count}`);

    if (timeSinceFirstSeen >= sustainedDuration) {
        // Face has been present for at least 1 second
        if (!tracking.sustainedStart) {
            tracking.sustainedStart = currentTime;
            console.log(`[面部跟踪] ${faceLabel} 达到持续时间，开始记录考勤`);
        }

        // Record attendance after sustained presence
        await recordAttendance(faceLabel, sessionId, attendanceKey);
    } else {
        // Reset sustained start if presence is interrupted
        tracking.sustainedStart = null;
        console.log(`[面部跟踪] ${faceLabel} 持续时间不足，还需 ${(sustainedDuration - timeSinceFirstSeen)/1000}秒`);
    }
}

async function recordAttendance(faceLabel, sessionId, attendanceKey) {
    try {
        // Find face by label
        const face = knownFaces.find(f => f.label === faceLabel);
        if (!face) return;

        // Parse face label to get class and course
        // Format: "班级 - 姓名 (课程)"
        const labelMatch = faceLabel.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)$/);
        if (!labelMatch) {
            console.error(`Invalid face label format: ${faceLabel}`);
            return;
        }

        const studentClass = labelMatch[1].trim();
        const studentName = labelMatch[2].trim();
        const studentCourse = labelMatch[3].trim();

        // Get current session details to validate
        const sessionResponse = await fetch(`/api/attendance/sessions`);
        const sessionData = await sessionResponse.json();

        const currentSession = sessionData.sessions.find(s => s.id === sessionId);
        if (!currentSession) {
            console.error(`Session not found: ${sessionId}`);
            return;
        }

        // Validate that student belongs to this session's class and course
        if (studentClass !== currentSession.class_name || studentCourse !== currentSession.course_name) {
            console.log(`[考勤验证失败] 学生 ${studentName} 不属于当前会话的班级(${currentSession.class_name})和课程(${currentSession.course_name})`);
            console.log(`[学生信息] 班级: ${studentClass}, 课程: ${studentCourse}`);

            // Add to log as invalid attendance
            const log = document.getElementById('attendance-log');
            const item = document.createElement('div');
            item.className = 'attendance-item invalid';
            item.textContent = `${new Date().toLocaleTimeString()} - ${faceLabel} ❌ (不属于当前班级/课程)`;
            log.appendChild(item);

            // Keep only last 10 entries
            while (log.children.length > 10) {
                log.removeChild(log.firstChild);
            }

            return;
        }

        // Student validation passed, record attendance
        const response = await fetch('/api/attendance', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                face_id: face.id,
                session_id: sessionId
            })
        });

        if (response.ok) {
            // Mark as recorded
            recordedAttendances.add(attendanceKey);

            // Add to attendance log
            const log = document.getElementById('attendance-log');
            const item = document.createElement('div');
            item.className = 'attendance-item';
            item.textContent = `${new Date().toLocaleTimeString()} - ${faceLabel} ✅ (持续检测)`;
            log.appendChild(item);

            // Keep only last 10 entries
            while (log.children.length > 10) {
                log.removeChild(log.firstChild);
            }

            console.log(`[考勤记录成功] ${faceLabel} 在会话 ${sessionId} 中记录 (持续检测)`);

            // Remove from tracking since attendance is recorded
            faceTracking.delete(face.id);
        } else {
            console.error(`[考勤记录失败] HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error recording attendance:', error);
    }
}

// Batch processing
async function processBatch() {
    const files = document.getElementById('batch-upload').files;
    if (files.length === 0) {
        showMessage('请选择图片文件', 'warning');
        return;
    }

    const sessionId = prompt('请输入会话ID:');
    if (!sessionId) return;

    const results = document.getElementById('batch-results');
    results.innerHTML = '<p>正在处理...</p>';

    let processed = 0;
    let recognized = 0;
    let invalid = 0;

    // Get current session details for validation
    let currentSession = null;
    try {
        const sessionResponse = await fetch('/api/attendance/sessions');
        const sessionData = await sessionResponse.json();
        currentSession = sessionData.sessions.find(s => s.id === sessionId);
    } catch (error) {
        console.error('Error fetching session details:', error);
        showMessage('无法获取会话信息', 'error');
        return;
    }

    if (!currentSession) {
        showMessage('无效的会话ID', 'error');
        return;
    }

    for (const file of files) {
        try {
            const image = await faceapi.bufferToImage(file);
            const detections = await faceapi.detectAllFaces(image, new faceapi.TinyFaceDetectorOptions())
                .withFaceDescriptors();

            for (const detection of detections) {
                if (faceMatcher) {
                    const match = faceMatcher.findBestMatch(detection.descriptor);
                    if (match.distance < 0.6) {
                        const face = knownFaces.find(f => f.label === match.label);
                        if (face) {
                            // Validate student belongs to current session
                            const labelMatch = match.label.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)$/);
                            if (labelMatch) {
                                const studentClass = labelMatch[1].trim();
                                const studentCourse = labelMatch[3].trim();

                                if (studentClass === currentSession.class_name && studentCourse === currentSession.course_name) {
                                    const attendanceKey = `${face.id}-${sessionId}`;
                                    if (!recordedAttendances.has(attendanceKey)) {
                                        await recordAttendance(match.label, sessionId, attendanceKey);
                                        recognized++;
                                    }
                                } else {
                                    console.log(`[批量处理] 学生 ${match.label} 不属于当前会话的班级和课程`);
                                    invalid++;
                                }
                            }
                        }
                    }
                }
            }
            processed++;
        } catch (error) {
            console.error('Error processing file:', file.name, error);
        }
    }

    results.innerHTML = `<p>处理完成：${processed}张图片，识别到${recognized}人次有效考勤，${invalid}人次无效考勤</p>`;
    showMessage('批量处理完成', 'success');
}

// Load sessions for dropdown
async function loadSessionsForReport() {
    try {
        const response = await fetch('/api/attendance/sessions');
        const data = await response.json();

        const sessionSelect = document.getElementById('report-session');
        sessionSelect.innerHTML = '<option value="">Select Session</option>';

        data.sessions.forEach(session => {
            const option = document.createElement('option');
            option.value = session.id;
            option.textContent = session.full_session_id;
            sessionSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading sessions:', error);
    }
}

// Reports
async function loadReport() {
    const sessionId = document.getElementById('report-session').value.trim();
    if (!sessionId) {
        showMessage('请选择会话', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/attendance/summary/${sessionId}`);
        const data = await response.json();

        const results = document.getElementById('report-results');
        results.innerHTML = '<h3>考勤统计</h3>';

        if (data.summary.length === 0) {
            results.innerHTML += '<p>该会话暂无考勤记录</p>';
            return;
        }

        const table = document.createElement('table');
        table.innerHTML = `
            <tr>
                <th>学生</th>
                <th>班级</th>
                <th>课程</th>
                <th>考勤次数</th>
                <th>操作</th>
            </tr>
        `;

        data.summary.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.name}</td>
                <td>${item.class}</td>
                <td>${item.course}</td>
                <td>${item.count}</td>
                <td><button onclick="showStudentDetails('${item.name}', '${item.class}', '${item.course}', '${sessionId}')">查看详情</button></td>
            `;
            table.appendChild(row);
        });

        results.appendChild(table);
    } catch (error) {
        console.error('Error loading report:', error);
        showMessage('加载报告失败', 'error');
    }
}

// Show student details with drill-down
async function showStudentDetails(studentName, className, courseName, sessionId) {
    try {
        // Get detailed attendance records for this student in this session
        const response = await fetch(`/api/attendance?session_id=${sessionId}&face_id=${getFaceIdByName(studentName)}`);
        const data = await response.json();

        const modal = document.createElement('div');
        modal.className = 'modal';

        modal.innerHTML = `
            <div class="modal-content">
                <h3>${studentName} - 考勤详情</h3>
                <p><strong>班级:</strong> ${className}</p>
                <p><strong>课程:</strong> ${courseName}</p>
                <p><strong>会话:</strong> ${sessionId}</p>

                <h4>考勤记录:</h4>
                <div id="student-attendance-details"></div>

                <button onclick="this.parentElement.parentElement.remove()">关闭</button>
            </div>
        `;

        const detailsDiv = modal.querySelector('#student-attendance-details');
        if (data.attendance.length === 0) {
            detailsDiv.innerHTML = '<p>暂无考勤记录</p>';
        } else {
            const list = document.createElement('ul');
            data.attendance.forEach(record => {
                const item = document.createElement('li');
                item.textContent = new Date(record.timestamp).toLocaleString();
                list.appendChild(item);
            });
            detailsDiv.appendChild(list);
        }

        document.body.appendChild(modal);
    } catch (error) {
        console.error('Error loading student details:', error);
        showMessage('加载学生详情失败', 'error');
    }
}

// Show course details with drill-down
async function showCourseDetails(courseName) {
    try {
        // Get detailed statistics for this course
        const response = await fetch(`/api/attendance/stats/course-details/${encodeURIComponent(courseName)}`);
        const data = await response.json();

        const modal = document.createElement('div');
        modal.className = 'modal';

        modal.innerHTML = `
            <div class="modal-content">
                <h3>${courseName} - 课程详情</h3>
                <p><strong>课程名称:</strong> ${courseName}</p>

                <h4>学生考勤详情:</h4>
                <div id="course-details-content"></div>

                <button onclick="this.parentElement.parentElement.remove()">关闭</button>
            </div>
        `;

        const detailsDiv = modal.querySelector('#course-details-content');
        if (data.details && data.details.length > 0) {
            const table = document.createElement('table');
            table.className = 'stats-table';
            table.innerHTML = `
                <tr>
                    <th>学生姓名</th>
                    <th>班级</th>
                    <th>考勤次数</th>
                    <th>出勤率</th>
                </tr>
            `;

            data.details.forEach(detail => {
                const row = document.createElement('tr');
                const rateClass = detail.attendance_rate >= 80 ? 'rate-high' :
                                detail.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';

                row.innerHTML = `
                    <td>${detail.name}</td>
                    <td>${detail.class}</td>
                    <td>${detail.attendance_count}</td>
                    <td class="${rateClass}">${detail.attendance_rate}%</td>
                `;
                table.appendChild(row);
            });

            detailsDiv.appendChild(table);
        } else {
            detailsDiv.innerHTML = '<p>暂无学生考勤数据</p>';
        }

        document.body.appendChild(modal);
    } catch (error) {
        console.error('Error loading course details:', error);
        showMessage('加载课程详情失败', 'error');
    }
}

// Show class details with drill-down
async function showClassDetails(className) {
    try {
        // Get detailed statistics for this class
        const response = await fetch(`/api/attendance/stats/class-details/${encodeURIComponent(className)}`);
        const data = await response.json();

        const modal = document.createElement('div');
        modal.className = 'modal';

        modal.innerHTML = `
            <div class="modal-content">
                <h3>${className} - 班级详情</h3>
                <p><strong>班级名称:</strong> ${className}</p>

                <h4>学生考勤详情:</h4>
                <div id="class-details-content"></div>

                <button onclick="this.parentElement.parentElement.remove()">关闭</button>
            </div>
        `;

        const detailsDiv = modal.querySelector('#class-details-content');
        if (data.details && data.details.length > 0) {
            const table = document.createElement('table');
            table.className = 'stats-table';
            table.innerHTML = `
                <tr>
                    <th>学生姓名</th>
                    <th>课程</th>
                    <th>考勤次数</th>
                    <th>出勤率</th>
                </tr>
            `;

            data.details.forEach(detail => {
                const row = document.createElement('tr');
                const rateClass = detail.attendance_rate >= 80 ? 'rate-high' :
                                detail.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';

                row.innerHTML = `
                    <td>${detail.name}</td>
                    <td>${detail.course}</td>
                    <td>${detail.attendance_count}</td>
                    <td class="${rateClass}">${detail.attendance_rate}%</td>
                `;
                table.appendChild(row);
            });

            detailsDiv.appendChild(table);
        } else {
            detailsDiv.innerHTML = '<p>暂无学生考勤数据</p>';
        }

        document.body.appendChild(modal);
    } catch (error) {
        console.error('Error loading class details:', error);
        showMessage('加载班级详情失败', 'error');
    }
}

// Helper function to get face ID by name
function getFaceIdByName(name) {
    const face = knownFaces.find(f => f.label.includes(name));
    return face ? face.id : null;
}

// Utility functions
function showMessage(message, type = 'info') {
    // Remove existing message
    const existingMessage = document.getElementById('system-message');
    if (existingMessage) {
        existingMessage.remove();
    }

    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.id = 'system-message';
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;

    // Style based on type
    const colors = {
        success: '#4CAF50',
        error: '#f44336',
        warning: '#ff9800',
        info: '#2196F3'
    };
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: ${colors[type]};
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        z-index: 1000;
        font-weight: bold;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        max-width: 300px;
    `;

    // Add to page
    document.body.appendChild(messageDiv);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 5000);
}

// Stop webcam
function stopWebcam() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
}

// Stop attendance session
async function stopAttendance() {
    if (!isAttendanceRunning) {
        showMessage('当前没有运行中的考勤会话', 'info');
        return;
    }

    try {
        // Update session with end time
        const endTime = new Date().toISOString();
        const response = await fetch(`/api/attendance/sessions/${currentSessionId}/end`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                end_time: endTime
            })
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`Session ended: ${data.final_session_id}`);
        }

    } catch (error) {
        console.error('Error ending session:', error);
    }

    stopWebcam();

    // Clear canvas
    const canvas = document.getElementById('attendance-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Reset attendance state
    isAttendanceRunning = false;
    currentSessionId = null;
    currentSessionStartTime = null;

    // Clear recorded attendances for new session
    recordedAttendances.clear();

    // Clear face tracking data
    faceTracking.clear();

    // Hide status indicator
    const statusDiv = document.getElementById('attendance-status');
    statusDiv.style.display = 'none';

    // Hide session info
    const sessionInfo = document.getElementById('current-session-info');
    sessionInfo.style.display = 'none';

    showMessage('考勤会话已停止', 'info');
    console.log('Attendance session stopped - cleared all tracking data');
}

// Statistics functions
async function loadOverallStats() {
    try {
        const response = await fetch('/api/attendance/stats/overall');
        const data = await response.json();

        document.getElementById('total-students').textContent = data.stats.total_students;
        document.getElementById('total-sessions').textContent = data.stats.total_sessions;
        document.getElementById('total-attendance').textContent = data.stats.total_attendance;
        document.getElementById('avg-attendance').textContent = data.stats.avg_attendance_rate + '%';
    } catch (error) {
        console.error('Error loading overall stats:', error);
        showMessage('Failed to load overall statistics', 'error');
    }
}

async function loadCourseStats() {
    try {
        const response = await fetch('/api/attendance/stats/by-course');
        const data = await response.json();

        // Enable fuzzy search + summary rendering via cache
        window.__courseStatsCache = data.stats || [];
        const courseSearch = document.getElementById('course-search');
        if (courseSearch && !courseSearch.__hooked) {
            courseSearch.__hooked = true;
            courseSearch.addEventListener('input', () => renderCourseStats(courseSearch.value || ''));
        }
        renderCourseStats('');
        return;

        const results = document.getElementById('course-stats-results');
        results.innerHTML = '';

        if (data.stats.length === 0) {
            results.innerHTML = '<p>No course statistics available</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'stats-table';
        table.innerHTML = `
            <tr>
                <th>Course</th>
                <th>Total Students</th>
                <th>Total Sessions</th>
                <th>Total Attendance</th>
                <th>Attendance Rate</th>
            </tr>
        `;

        data.stats.forEach(stat => {
            const row = document.createElement('tr');
            const rateClass = stat.attendance_rate >= 80 ? 'rate-high' :
                            stat.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';

            row.innerHTML = `
                <td><a href="#" onclick="showCourseDetails('${stat.course}')" class="drill-down-link">${stat.course}</a></td>
                <td>${stat.total_students}</td>
                <td>${stat.total_sessions}</td>
                <td>${stat.total_attendance}</td>
                <td class="${rateClass}">${stat.attendance_rate}%</td>
            `;
            table.appendChild(row);
        });

        results.appendChild(table);
    } catch (error) {
        console.error('Error loading course stats:', error);
        showMessage('Failed to load course statistics', 'error');
    }
}

async function loadClassStats() {
    try {
        const response = await fetch('/api/attendance/stats/by-class');
        const data = await response.json();

        const results = document.getElementById('class-stats-results');
        results.innerHTML = '';

        if (data.stats.length === 0) {
            results.innerHTML = '<p>No class statistics available</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'stats-table';
        table.innerHTML = `
            <tr>
                <th>Class</th>
                <th>Total Students</th>
                <th>Total Sessions</th>
                <th>Total Attendance</th>
                <th>Attendance Rate</th>
            </tr>
        `;

        data.stats.forEach(stat => {
            const row = document.createElement('tr');
            const rateClass = stat.attendance_rate >= 80 ? 'rate-high' :
                            stat.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';

            row.innerHTML = `
                <td><a href="#" onclick="return showClassAccordion('${stat.class}', this)" class="drill-down-link">${stat.class}</a></td>
                <td>${stat.total_students}</td>
                <td>${stat.total_sessions}</td>
                <td>${stat.total_attendance}</td>
                <td class="${rateClass}">${stat.attendance_rate}%</td>
            `;
            table.appendChild(row);
        });

        results.appendChild(table);
    } catch (error) {
        console.error('Error loading class stats:', error);
        showMessage('Failed to load class statistics', 'error');
    }
}

// Check camera permission status
async function checkCameraPermission() {
    try {
        const result = await navigator.permissions.query({ name: 'camera' });
        console.log('Camera permission status:', result.state);

        updateCameraStatus(result.state);

        if (result.state === 'denied') {
            showMessage('摄像头权限已被拒绝，请在浏览器设置中允许摄像头访问', 'warning');
            return false;
        } else if (result.state === 'prompt') {
            showMessage('系统将请求摄像头权限，请点击"允许"', 'info');
        } else if (result.state === 'granted') {
            console.log('Camera permission granted');
        }
        return true;
    } catch (error) {
        // Fallback for browsers that don't support permissions API
        console.log('Permissions API not supported, will check on first use');
        updateCameraStatus('unknown');
        return true;
    }
}

// Update camera status indicator
function updateCameraStatus(status) {
    const cameraIcon = document.getElementById('camera-icon');
    const cameraText = document.getElementById('camera-text');

    if (!cameraIcon || !cameraText) return;

    switch (status) {
        case 'granted':
            cameraIcon.textContent = '📷✅';
            cameraText.textContent = '摄像头状态: 已授权';
            cameraText.style.color = '#28a745';
            break;
        case 'denied':
            cameraIcon.textContent = '📷❌';
            cameraText.textContent = '摄像头状态: 被拒绝';
            cameraText.style.color = '#dc3545';
            break;
        case 'prompt':
            cameraIcon.textContent = '📷❓';
            cameraText.textContent = '摄像头状态: 等待授权';
            cameraText.style.color = '#ffc107';
            break;
        default:
            cameraIcon.textContent = '📷🔄';
            cameraText.textContent = '摄像头状态: 检查中...';
            cameraText.style.color = '#6c757d';
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', async function() {
    const hasData = document.getElementById('data-page');
    const hasAttendance = document.getElementById('attendance-page');
    const hasReports = document.getElementById('reports-page');
    const hasStats = document.getElementById('statistics-page');
    const hasBatch = document.getElementById('batch-page');

    if (hasAttendance || hasData) {
        await checkCameraPermission();
    }

    if (hasData) {
        // Data & Register needs models for face registration
        init();
    } else if (hasAttendance) {
        // Attendance requires models + known faces
        init();
    } else if (hasReports) {
        loadSessionsForReport();
    } else if (hasStats) {
        loadOverallStats();
        loadCourseStats();
        loadClassStats();
        loadStudentStats();
    } else if (hasBatch) {
        // Batch page: no special init required
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', stopWebcam);

// =========================
// Data Management (Students / Courses / Mappings)
// =========================
function setDataResults(html) {
    const div = document.getElementById('data-results');
    if (div) div.innerHTML = html;
}
function jsonPre(obj) {
    const escaped = JSON.stringify(obj, null, 2)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>');
    return `<pre style="background:#f7f7f9;border:1px solid #e1e1e8;padding:10px;overflow:auto;max-height:260px">${escaped}</pre>`;
}

// Import students from folder: expects file input #student-folder with webkitdirectory
async function importStudentsFromFolder() {
    try {
        const input = document.getElementById('student-folder');
        const files = Array.from((input && input.files) || []);
        if (files.length === 0) {
            showMessage('请选择包含学生照片的文件夹', 'warning');
            return;
        }
        // Filter images
        const imageExt = /\.(jpg|jpeg|png)$/i;
        const images = files.filter(f => imageExt.test(f.name));
        if (images.length === 0) {
            showMessage('选中的文件夹中没有 jpg/jpeg/png 图片', 'warning');
            return;
        }

        setDataResults('<p>正在导入学生，请稍候...</p>');

        const form = new FormData();
        for (const file of images) {
            form.append('photos', file, file.name);
        }
        // Optional default gender from UI (if needed extend later)
        // form.append('gender', '');

        const resp = await fetch('/api/students/import/photos', {
            method: 'POST',
            body: form
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(err || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        showMessage(`学生导入完成：插入 ${data.inserted}，更新 ${data.updated}，跳过 ${data.skipped}`, 'success');
        setDataResults(`
            <h4>学生导入结果</h4>
            <ul>
              <li>处理总数: ${data.processed}</li>
              <li>插入: ${data.inserted}</li>
              <li>更新: ${data.updated}</li>
              <li>跳过: ${data.skipped}</li>
            </ul>
            ${data.errors && data.errors.length ? ('<h5>错误列表</h5>' + jsonPre(data.errors)) : ''}
        `);
    } catch (e) {
        console.error(e);
        showMessage(`学生导入失败: ${e.message}`, 'error');
    }
}

// Manual create student
async function submitNewStudent() {
    try {
        const sn = document.getElementById('student-number-input').value.trim();
        const name = document.getElementById('student-name-input').value.trim();
        const gender = document.getElementById('student-gender-input').value;
        if (!sn || !name) {
            showMessage('请填写学号与姓名', 'warning');
            return;
        }
        const resp = await fetch('/api/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_number: sn, name, gender })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || resp.statusText);
        showMessage('学生创建成功', 'success');
        setDataResults(`<h4>新建学生</h4>${jsonPre(data.student || data)}`);
        // Clear inputs
        document.getElementById('student-number-input').value = '';
        document.getElementById('student-name-input').value = '';
        document.getElementById('student-gender-input').value = '';
    } catch (e) {
        console.error(e);
        showMessage(`学生创建失败: ${e.message}`, 'error');
    }
}

// Import courses from Excel
async function importCoursesFromExcel() {
    try {
        const input = document.getElementById('courses-excel');
        const file = (input && input.files && input.files[0]) || null;
        if (!file) {
            showMessage('请选择Excel文件', 'warning');
            return;
        }
        setDataResults('<p>正在导入课程，请稍候...</p>');
        const form = new FormData();
        form.append('file', file, file.name);
        const resp = await fetch('/api/courses/import/excel', { method: 'POST', body: form });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || resp.statusText);
        showMessage(`课程导入完成：插入 ${data.inserted}，更新 ${data.updated}，跳过 ${data.skipped}`, 'success');
        setDataResults(`
            <h4>课程导入结果</h4>
            <ul>
              <li>处理总数: ${data.processed}</li>
              <li>插入: ${data.inserted}</li>
              <li>更新: ${data.updated}</li>
              <li>跳过: ${data.skipped}</li>
            </ul>
            ${data.errors && data.errors.length ? ('<h5>错误列表</h5>' + jsonPre(data.errors)) : ''}
        `);
    } catch (e) {
        console.error(e);
        showMessage(`课程导入失败: ${e.message}`, 'error');
    }
}

// Manual create course
async function submitNewCourse() {
    try {
        const code = document.getElementById('course-code-input').value.trim();
        const name = document.getElementById('course-name-input').value.trim();
        const hoursRaw = document.getElementById('course-hours-input').value;
        if (!code || !name) {
            showMessage('请填写课程编号与课程名称', 'warning');
            return;
        }
        const hours = hoursRaw === '' ? null : Number(hoursRaw);
        const resp = await fetch('/api/courses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_code: code, course_name: name, course_hours: hours })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || resp.statusText);
        showMessage('课程创建成功', 'success');
        setDataResults(`<h4>新建课程</h4>${jsonPre(data.course || data)}`);
        // Clear inputs
        document.getElementById('course-code-input').value = '';
        document.getElementById('course-name-input').value = '';
        document.getElementById('course-hours-input').value = '';
    } catch (e) {
        console.error(e);
        showMessage(`课程创建失败: ${e.message}`, 'error');
    }
}

// Create course-student mapping
async function submitNewMapping() {
    try {
        const sn = document.getElementById('map-student-number').value.trim();
        const cc = document.getElementById('map-course-code').value.trim();
        if (!sn || !cc) {
            showMessage('请填写学号与课程编号', 'warning');
            return;
        }
        const resp = await fetch('/api/course-students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_number: sn, course_code: cc })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || resp.statusText);
        showMessage('课程-学生映射添加成功', 'success');
        setDataResults(`<h4>新增映射</h4>${jsonPre(data.mapping || data)}`);
        // Clear inputs
        document.getElementById('map-student-number').value = '';
        document.getElementById('map-course-code').value = '';
    } catch (e) {
        console.error(e);
        showMessage(`映射添加失败: ${e.message}`, 'error');
    }
}
// Bulk import course-student mappings from Excel
async function importCourseStudentMappingsFromExcel() {
    try {
        const input = document.getElementById('mappings-excel');
        const file = (input && input.files && input.files[0]) || null;
        if (!file) {
            showMessage('请选择Excel文件', 'warning');
            return;
        }

        setDataResults('<p>正在导入课程-学生映射，请稍候...</p>');

        const form = new FormData();
        form.append('file', file, file.name);

        const resp = await fetch('/api/course-students/import/excel', { method: 'POST', body: form });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || resp.statusText);

        showMessage(`映射导入完成：插入 ${data.inserted}，更新 ${data.updated}，跳过 ${data.skipped}`, 'success');
        setDataResults(`
            <h4>映射导入结果</h4>
            <ul>
              <li>处理总数: ${data.processed}</li>
              <li>插入: ${data.inserted}</li>
              <li>更新: ${data.updated}</li>
              <li>跳过: ${data.skipped}</li>
            </ul>
            ${data.errors && data.errors.length ? ('<h5>错误列表（例如学号或课程编号不存在）</h5>' + jsonPre(data.errors)) : ''}
        `);
    } catch (e) {
        console.error(e);
        showMessage(`映射导入失败: ${e.message}`, 'error');
    }
}

// Hide legacy headings/blocks if still present in HTML
function hideLegacyStatisticsBlocks() {
    try {
        const statsPage = document.getElementById('statistics-page');
        if (!statsPage) return;
        const toHideTexts = new Set(['Statistics by Course', 'Statistics by Class']);
        statsPage.querySelectorAll('h3').forEach(h => {
            const text = (h.textContent || '').trim();
            if (toHideTexts.has(text)) {
                const block = h.closest('.stats-overview') || h.parentElement;
                if (block) block.style.display = 'none'; else h.style.display = 'none';
            }
        });
        // Also hide legacy load buttons if any
        statsPage.querySelectorAll('button').forEach(btn => {
            const t = (btn.textContent || '').trim();
            if (t === 'Load Course Statistics' || t === 'Load Class Statistics') {
                const p = btn.parentElement; if (p) p.style.display = 'none'; else btn.style.display = 'none';
            }
        });
    } catch (e) {
        console.warn('hideLegacyStatisticsBlocks failed:', e);
    }
}
// Switch small tabs inside statistics page
function switchStatsTab(which) {
    const panels = {
        course: document.getElementById('tab-course'),
        class: document.getElementById('tab-class'),
        student: document.getElementById('tab-student'),
    };
    Object.keys(panels).forEach(k => {
        if (panels[k]) panels[k].style.display = (k === which ? 'block' : 'none');
    });
    const btns = document.querySelectorAll('.stats-tabs .tab-button');
    btns.forEach(btn => btn.classList.remove('active'));
    const idx = { course: 0, class: 1, student: 2 }[which];
    if (btns[idx]) btns[idx].classList.add('active');
}

// Accordion utilities and drill-down renderers
function toggleAccordionAfterRow(tr, contentHtml, colSpan) {
    if (!tr) return;
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('accordion-row')) {
        existing.remove();
        return;
    }
    const table = tr.closest('table');
    if (table) table.querySelectorAll('.accordion-row').forEach(n => n.remove());
    const acc = document.createElement('tr');
    acc.className = 'accordion-row';
    const td = document.createElement('td');
    td.colSpan = colSpan;
    td.innerHTML = `<div class="accordion-inner">${contentHtml}</div>`;
    acc.appendChild(td);
    tr.after(acc);
}

async function showCourseAccordion(courseName, anchor) {
    try {
        const response = await fetch(`/api/attendance/stats/course-details/${encodeURIComponent(courseName)}`);
        const data = await response.json();
        let html = '';
        if (data.details && data.details.length) {
            const rows = data.details.map(d => {
                const rateClass = d.attendance_rate >= 80 ? 'rate-high' : d.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';
                return `<tr><td>${d.name}</td><td>${d.class}</td><td>${d.attendance_count}</td><td class="${rateClass}">${d.attendance_rate}%</td></tr>`;
            }).join('');
            html = `<table class="stats-table"><tr><th>学生姓名</th><th>班级</th><th>考勤次数</th><th>出勤率</th></tr>${rows}</table>`;
        } else {
            html = '<p>暂无学生考勤数据</p>';
        }
        const tr = anchor.closest('tr');
        const table = tr.closest('table');
        const colSpan = table ? table.querySelectorAll('th').length : 5;
        toggleAccordionAfterRow(tr, html, colSpan);
        return false;
    } catch (e) {
        console.error('Error loading course details:', e);
        showMessage('加载课程详情失败', 'error');
    }
}

async function showClassAccordion(className, anchor) {
    try {
        const response = await fetch(`/api/attendance/stats/class-details/${encodeURIComponent(className)}`);
        const data = await response.json();
        let html = '';
        if (data.details && data.details.length) {
            const rows = data.details.map(d => {
                const rateClass = d.attendance_rate >= 80 ? 'rate-high' : d.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';
                return `<tr><td>${d.name}</td><td>${d.course}</td><td>${d.attendance_count}</td><td class="${rateClass}">${d.attendance_rate}%</td></tr>`;
            }).join('');
            html = `<table class="stats-table"><tr><th>学生姓名</th><th>课程</th><th>考勤次数</th><th>出勤率</th></tr>${rows}</table>`;
        } else {
            html = '<p>暂无学生考勤数据</p>';
        }
        const tr = anchor.closest('tr');
        const table = tr.closest('table');
        const colSpan = table ? table.querySelectorAll('th').length : 5;
        toggleAccordionAfterRow(tr, html, colSpan);
        return false;
    } catch (e) {
        console.error('Error loading class details:', e);
        showMessage('加载班级详情失败', 'error');
    }
}

async function showStudentAccordion(name, className, anchor) {
    try {
        const resp = await fetch(`/api/attendance/stats/student-details?name=${encodeURIComponent(name)}&class=${encodeURIComponent(className)}`);
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status} ${resp.statusText} ${text ? '- ' + text.slice(0,120) : ''}`);
        }
        const data = await resp.json();
        let html = '';
        if (Array.isArray(data.details) && data.details.length) {
            const rows = data.details.map(d => {
                const rateClass = d.attendance_rate >= 80 ? 'rate-high' : d.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';
                return `<tr><td>${d.course}</td><td>${d.attendance_count}</td><td>${d.total_sessions}</td><td class="${rateClass}">${d.attendance_rate}%</td></tr>`;
            }).join('');
            html = `<div class="summary-text">Courses: ${data.totals?.courses || 0} | Attended: ${data.totals?.attendance_count || 0} | Total Sessions: ${data.totals?.total_sessions || 0} | Avg: ${(Number(data.totals?.avg_attendance_rate || 0)).toFixed(2)}%</div>
                    <table class="stats-table"><tr><th>Course</th><th>Attended</th><th>Total Sessions</th><th>Attendance Rate</th></tr>${rows}</table>`;
        } else {
            html = '<p>暂无课程考勤数据</p>';
        }
        const tr = anchor.closest('tr');
        const table = tr.closest('table');
        const colSpan = table ? table.querySelectorAll('th').length : 6;
        toggleAccordionAfterRow(tr, html, colSpan);
        return false;
    } catch (e) {
        console.error('Error loading student details:', e);
        showMessage('加载学生详情失败', 'error');
    }
}

// Render course stats with optional filter and summary
function renderCourseStats(filterText = '') {
    const results = document.getElementById('course-stats-results');
    const summary = document.getElementById('course-summary');
    if (!results) return;
    results.innerHTML = '';

    const all = Array.isArray(window.__courseStatsCache) ? window.__courseStatsCache : [];
    const text = (filterText || '').toLowerCase();
    const filtered = text ? all.filter(x => String(x.course || '').toLowerCase().includes(text)) : all.slice();

    if (filtered.length === 0) {
        results.innerHTML = '<p>No course statistics available</p>';
        if (summary) summary.textContent = 'Courses: 0 | Students: 0 | Avg: 0%';
        return;
    }

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `
        <tr>
            <th>Course</th>
            <th>Total Students</th>
            <th>Total Sessions</th>
            <th>Total Attendance</th>
            <th>Attendance Rate</th>
        </tr>
    `;

    let totalStudents = 0;
    let avgAcc = 0;
    filtered.forEach(stat => {
        const row = document.createElement('tr');
        const rateClass = stat.attendance_rate >= 80 ? 'rate-high' : stat.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';
        totalStudents += Number(stat.total_students || 0);
        avgAcc += Number(stat.attendance_rate || 0);

        row.innerHTML = `
            <td><a href="#" onclick="return showCourseAccordion('${stat.course}', this)" class="drill-down-link">${stat.course}</a></td>
            <td>${stat.total_students}</td>
            <td>${stat.total_sessions}</td>
            <td>${stat.total_attendance}</td>
            <td class="${rateClass}">${stat.attendance_rate}%</td>
        `;
        table.appendChild(row);
    });

    results.appendChild(table);
    if (summary) {
        const avg = filtered.length ? (avgAcc / filtered.length).toFixed(2) : '0.00';
        summary.textContent = `Courses: ${filtered.length} | Students: ${totalStudents} | Avg: ${avg}%`;
    }
}

// Students statistics
async function loadStudentStats() {
    try {
        const resp = await fetch('/api/attendance/stats/students');
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status} ${resp.statusText} ${text ? '- ' + text.slice(0,120) : ''}`);
        }
        const ct = resp.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            const text = await resp.text().catch(() => '');
            throw new Error(`Unexpected content-type: ${ct || 'unknown'} ${text ? '- ' + text.slice(0,120) : ''}`);
        }
        const data = await resp.json();
        window.__studentStatsCache = data.students || [];

        const studentSearch = document.getElementById('student-search');
        if (studentSearch && !studentSearch.__hooked) {
            studentSearch.__hooked = true;
            studentSearch.addEventListener('input', () => renderStudentStats(studentSearch.value || ''));
        }

        renderStudentStats('');
    } catch (err) {
        console.error('Error loading student stats:', err);
        showMessage('Failed to load student statistics', 'error');
    }
}

function renderStudentStats(filterText = '') {
    const results = document.getElementById('student-stats-results');
    const summary = document.getElementById('student-summary');
    if (!results) return;
    results.innerHTML = '';

    const all = Array.isArray(window.__studentStatsCache) ? window.__studentStatsCache : [];
    const text = (filterText || '').toLowerCase();
    const filtered = text ? all.filter(x => `${x.name || ''} ${x.class || ''}`.toLowerCase().includes(text)) : all.slice();

    if (filtered.length === 0) {
        results.innerHTML = '<p>No student statistics available</p>';
        if (summary) summary.textContent = 'Students: 0 | Courses: 0 | Avg: 0%';
        return;
    }

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `
        <tr>
            <th>Name</th>
            <th>Class</th>
            <th>Courses</th>
            <th>Attended</th>
            <th>Total Sessions</th>
            <th>Attendance Rate</th>
        </tr>
    `;

    let totalCourses = 0;
    let avgAcc = 0;
    filtered.forEach(s => {
        const row = document.createElement('tr');
        const rateClass = s.attendance_rate >= 80 ? 'rate-high' : s.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';
        totalCourses += Number(s.courses_count || 0);
        avgAcc += Number(s.attendance_rate || 0);
        const safeName = String(s.name || '').replace(/'/g, "\\'");
        const safeClass = String(s.class || '').replace(/'/g, "\\'");
    const nameLink = `<a href=\"#\" onclick=\"return showStudentAccordion('${safeName}', '${safeClass}', this)\" class=\"drill-down-link\">${s.name}</a>`;

        row.innerHTML = `
            <td>${nameLink}</td>
            <td>${s.class}</td>
            <td>${s.courses_count}</td>
            <td>${s.attendance_count}</td>
            <td>${s.total_sessions}</td>
            <td class="${rateClass}">${s.attendance_rate}%</td>
        `;
        table.appendChild(row);
    });

    results.appendChild(table);
    if (summary) {
        const avg = filtered.length ? (avgAcc / filtered.length).toFixed(2) : '0.00';
        summary.textContent = `Students: ${filtered.length} | Courses: ${totalCourses} | Avg: ${avg}%`;
    }
}

async function showStudentDrillDown(name, className) {
    try {
        const resp = await fetch(`/api/attendance/stats/student-details?name=${encodeURIComponent(name)}&class=${encodeURIComponent(className)}`);
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status} ${resp.statusText} ${text ? '- ' + text.slice(0,120) : ''}`);
        }
        const data = await resp.json();

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Student Details - ${name} (${className})</h3>
                <div id="student-details-summary" class="hint" style="margin: 8px 0;"></div>
                <div id="student-details-content"></div>
                <div style="margin-top: 12px; text-align: right;"><button onclick="this.closest('.modal').remove()">关闭</button></div>
            </div>
        `;

        const detailsDiv = modal.querySelector('#student-details-content');
        const summaryDiv = modal.querySelector('#student-details-summary');

        if (Array.isArray(data.details) && data.details.length) {
            const table = document.createElement('table');
            table.className = 'stats-table';
            table.innerHTML = `
                <tr>
                    <th>Course</th>
                    <th>Attended</th>
                    <th>Total Sessions</th>
                    <th>Attendance Rate</th>
                </tr>
            `;

            data.details.forEach(d => {
                const row = document.createElement('tr');
                const rateClass = d.attendance_rate >= 80 ? 'rate-high' : d.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';
                row.innerHTML = `
                    <td>${d.course}</td>
                    <td>${d.attendance_count}</td>
                    <td>${d.total_sessions}</td>
                    <td class=\"${rateClass}\">${d.attendance_rate}%</td>
                `;
                table.appendChild(row);
            });
            detailsDiv.appendChild(table);
        } else {
            detailsDiv.innerHTML = '<p>暂无课程考勤数据</p>';
        }

        if (data.totals) {
            const avg = Number(data.totals.avg_attendance_rate || 0).toFixed(2);
            summaryDiv.textContent = `Courses: ${data.totals.courses} | Attended: ${data.totals.attendance_count} | Total Sessions: ${data.totals.total_sessions} | Avg: ${avg}%`;
        }

        document.body.appendChild(modal);
    } catch (e) {
        console.error('Error loading student details:', e);
        showMessage('加载学生详情失败', 'error');
    }
}
