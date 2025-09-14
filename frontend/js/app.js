// Global variables
let faceMatcher = null;
let knownFaces = [];
let currentStream = null;
let isModelsLoaded = false;
let isAttendanceRunning = false;
let currentSessionId = null;
let currentSessionStartTime = null;
let sessionSaved = false; // true only if at least one buffered record was uploaded
let pendingSessionMeta = null; // { class_name, course_name, start_time }

// Face tracking for sustained detection
let faceTracking = new Map(); // faceId -> {count, firstSeen, lastSeen}

 // Buffered attendance (student_number -> { label, hist, face_id, firstSeenAt })
 let bufferedAttendances = new Map();

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
        // Hide loading overlay and show error (if overlay exists)
        const ov = document.getElementById('loading-overlay');
        if (ov) ov.style.display = 'none';
        showMessage('系统初始化失败，请刷新页面重试', 'error');
    }
}

// Load face-api.js models
async function loadModels() {
    // Use local models from the weights directory served by our backend
    const MODEL_URL = '/weights/';
    const progressBar = document.getElementById('loading-progress');
    const overlay = document.getElementById('loading-overlay');

    const setOverlayText = (text) => {
        if (!overlay) return;
        const container = overlay.querySelector('div');
        if (container) container.textContent = text;
    };
    const setProgress = (pct) => {
        if (progressBar && typeof pct === 'number') {
            progressBar.style.width = `${pct}%`;
        }
    };

    try {
        setOverlayText('正在加载面部检测模型...');
        setProgress(20);
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

        setOverlayText('正在加载面部特征点模型...');
        setProgress(40);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

        setOverlayText('正在加载面部识别模型...');
        setProgress(60);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        setOverlayText('正在加载年龄/性别模型...');
        setProgress(80);
        await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);

        setOverlayText('模型加载完成！');
        setProgress(100);
        isModelsLoaded = true;

        // Hide loading overlay after a short delay (if present)
        if (overlay) {
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 1000);
        }

        console.log('All models loaded successfully from local server');
    } catch (error) {
        console.error('Error loading models:', error);
        setOverlayText('模型加载失败');
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
        const [combosResp, studentsResp, coursesResp] = await Promise.all([
            fetch('/api/attendance/classes-courses'),
            fetch('/api/students'),
            fetch('/api/courses')
        ]);
        const combosData = await combosResp.json().catch(() => ({ combinations: [] }));
        const studentsData = await studentsResp.json().catch(() => ({ students: [] }));
        const coursesData = await coursesResp.json().catch(() => ({ courses: [] }));
 
        classCourseData = combosData.combinations || [];
 
        const studentList = Array.isArray(studentsData) ? studentsData : (studentsData.students || []);
        const courseList = Array.isArray(coursesData) ? coursesData : (coursesData.courses || []);
 
        // Build quick index by name|class for resolving student_number during attendance
        try {
            window.__studentsIndexByNameClass = new Map();
            (studentList || []).forEach(s => {
                const key = `${(s.name || '').trim()}|${(s.class_name || '').trim()}`;
                window.__studentsIndexByNameClass.set(key, s);
            });
        } catch (e) { console.warn('build students index failed', e); }
 
        const classesFromCombos = classCourseData.map(item => item.class_name).filter(Boolean);
        const classesFromStudents = studentList.map(s => s.class_name).filter(Boolean);
        window.__allClasses = Array.from(new Set([...classesFromCombos, ...classesFromStudents])).sort();
 
        const coursesFromCombos = classCourseData.map(item => item.course_name).filter(Boolean);
        const coursesFromTable = courseList.map(c => c.course_name).filter(Boolean);
        window.__allCourses = Array.from(new Set([...coursesFromCombos, ...coursesFromTable])).sort();
 
        // Populate class dropdown
        populateClassDropdown();
 
        console.log(`Loaded combos=${classCourseData.length}, classes=${(window.__allClasses||[]).length}, courses=${(window.__allCourses||[]).length}`);
    } catch (error) {
        console.error('Error loading class-course data:', error);
    }
}

 // Populate class options (combobox + fallback select)
 function populateClassDropdown() {
     const uniqueClasses = Array.isArray(window.__allClasses)
         ? window.__allClasses
         : [...new Set(classCourseData.map(item => item.class_name))];

     // Datalist for unified combobox
     const dl = document.getElementById('class-options');
     if (dl) {
         dl.innerHTML = '';
         uniqueClasses.forEach(className => {
             const opt = document.createElement('option');
             opt.value = className;
             dl.appendChild(opt);
         });
     }

     // Fallback select (if present)
     const classSelect = document.getElementById('class-select');
     if (classSelect) {
         classSelect.innerHTML = '<option value="">Select Class</option>';
         uniqueClasses.forEach(className => {
             const option = document.createElement('option');
             option.value = className;
             option.textContent = className;
             classSelect.appendChild(option);
         });
     }

     // Refresh course options
     updateCourseOptions();
 }

 // Update course options (combobox + fallback select)
 function updateCourseOptions() {
     const classSelect = document.getElementById('class-select');
     const classInput = document.getElementById('class-combobox');
     const selectedClass = classInput ? classInput.value.trim() : (classSelect ? classSelect.value : '');

     // All courses (mapping not enforced at this stage)
     const allCourses = Array.isArray(window.__allCourses) && window.__allCourses.length
         ? window.__allCourses
         : [...new Set(classCourseData.map(item => item.course_name).filter(Boolean))];

     // Datalist for unified combobox
     const dl = document.getElementById('course-options');
     if (dl) {
         dl.innerHTML = '';
         allCourses.forEach(courseName => {
             const opt = document.createElement('option');
             opt.value = courseName;
             dl.appendChild(opt);
         });
     }

     // Fallback select (if present)
     const courseSelect = document.getElementById('course-select');
     if (courseSelect) {
         courseSelect.innerHTML = '<option value="">Select Course</option>';
         allCourses.forEach(courseName => {
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
    // Defensive: ensure ageGender is available
    if (!faceapi.nets.ageGenderNet.params) {
        try { await faceapi.nets.ageGenderNet.loadFromUri('/weights/'); } catch (_) {}
    }

    const video = document.getElementById('registration-video');
    const canvas = document.getElementById('registration-canvas');

    try {
        const detection = await faceapi
            .detectSingleFace(
                video,
                new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })
            )
            .withFaceLandmarks()
            .withFaceDescriptor()
            .withAgeAndGender();

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

            // Register the face (pass gender)
            await registerFace(detection.descriptor, detection.gender);
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
    // Defensive: ensure ageGender is available
    if (!faceapi.nets.ageGenderNet.params) {
        try { await faceapi.nets.ageGenderNet.loadFromUri('/weights/'); } catch (_) {}
    }

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
        const detection = await faceapi
            .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
            .withFaceLandmarks()
            .withFaceDescriptor()
            .withAgeAndGender();

        if (detection) {
            await registerFace(detection.descriptor, detection.gender);
        } else {
            showMessage('图片中未检测到人脸，请选择其他图片', 'warning');
        }
    } catch (error) {
        console.error('Error processing image:', error);
        showMessage('图片处理失败，请重试', 'error');
    }
}

// Register face with server
async function registerFace(descriptor, detectedGender) {
    const className = (document.getElementById('student-class')?.value || '').trim();
    const studentNumber = (document.getElementById('student-number')?.value || '').trim();
    const name = (document.getElementById('student-name')?.value || '').trim();
    const course = ''; // registration no longer requires course

    if (!className || !name) {
        showMessage('请填写完整的学生信息', 'warning');
        return;
    }
    if (!studentNumber) {
        showMessage('请填写学号', 'warning');
        return;
    }

    try {
        // 1) Save to faces (legacy pipeline)
        const response = await fetch('/api/faces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                label: `${className}-${name}`,
                descriptors: Array.from(descriptor),
                class: className,
                name: name,
                course: ''
            })
        });

        // 2) Upsert into students with gender + class + descriptors
        if (studentNumber) {
            const gender = detectedGender || null;
            try {
                const createResp = await fetch('/api/students', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        student_number: studentNumber,
                        name,
                        gender,
                        class_name: className,
                        face_descriptors: Array.from(descriptor),
                        photo_path: null
                    })
                });
                if (!createResp.ok && createResp.status === 409) {
                    // already exists -> update it
                    const listResp = await fetch('/api/students');
                    const listData = await listResp.json();
                    const list = Array.isArray(listData) ? listData : (listData.students || []);
                    const existing = list.find(s => String(s.student_number) === String(studentNumber));
                    if (existing) {
                        await fetch(`/api/students/${existing.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                name,
                                gender,
                                class_name: className,
                                face_descriptors: Array.from(descriptor)
                            })
                        });
                    }
                }
            } catch (e) {
                console.warn('Upsert student failed:', e);
            }
        }

        if (response.ok) {
            // Upload captured or selected photo to persist on server
            try {
                let photoBlob = null;
                const fileInputEl = document.getElementById('image-upload');
                const selectedFile = fileInputEl && fileInputEl.files && fileInputEl.files[0];
                if (selectedFile) {
                    photoBlob = selectedFile;
                } else {
                    const canvasEl = document.getElementById('registration-canvas');
                    if (canvasEl && canvasEl.toBlob) {
                        photoBlob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/jpeg', 0.92));
                    }
                }
                if (photoBlob) {
                    await uploadStudentPhoto(studentNumber, name, className, detectedGender, photoBlob);
                }
            } catch (e) { console.warn('Upload photo skipped:', e); }
 
            const zhGender = displayGender(detectedGender);
            showMessage(`学生注册成功！${zhGender ? '性别: ' + zhGender : ''}`, 'success');
            await loadKnownFaces(); // Reload faces for matcher
            // Clear form
            const fields = ['student-class','student-number','student-name'];
            fields.forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
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
    const classInput = document.getElementById('class-combobox');
    const courseInput = document.getElementById('course-combobox');
 
    const selectedClass = classInput ? classInput.value.trim() : (classSelect ? classSelect.value : '');
    const selectedCourse = courseInput ? courseInput.value.trim() : (courseSelect ? courseSelect.value : '');

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

        // Do NOT create session yet; defer creation until upload time
        const startTime = new Date().toISOString();
        pendingSessionMeta = {
            class_name: selectedClass,
            course_name: selectedCourse,
            start_time: startTime
        };
        currentSessionId = null;
        currentSessionStartTime = startTime;
        console.log(`[考勤启动] 已准备待保存会话: ${selectedClass} - ${selectedCourse} @ ${startTime}`);

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

        // Hide old overlay canvas (we use HTML overlay instead)
        if (canvas) { canvas.style.display = 'none'; }

        // Set attendance running flag
        isAttendanceRunning = true;

        console.log('[考勤启动] 开始面部检测循环...');

        // Show status indicator
        const statusDiv = document.getElementById('attendance-status');
        const statusText = document.getElementById('status-text');
        statusText.textContent = '考勤系统运行中...';
        statusDiv.style.display = 'block';

        // Start face detection loop (switch buttons to "Upload" mode)
        if (typeof switchToUploadButtons === 'function') switchToUploadButtons();
        bufferedAttendances.clear();
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

        // Render HTML overlay boxes on top of video (no canvas)
        try {
            // Ensure overlay element exists
            let overlay = document.getElementById('attendance-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'attendance-overlay';
                overlay.style.position = 'absolute';
                overlay.style.pointerEvents = 'none';
                overlay.style.zIndex = '999';
                document.body.appendChild(overlay);
            }
            // Position overlay to align with video element
            const rect = video.getBoundingClientRect();
            overlay.style.left = `${Math.round(rect.left + window.scrollX)}px`;
            overlay.style.top = `${Math.round(rect.top + window.scrollY)}px`;
            overlay.style.width = `${Math.round(rect.width)}px`;
            overlay.style.height = `${Math.round(rect.height)}px`;
 
            // Build overlay items with labels
            const scaleX = rect.width / video.videoWidth;
            const scaleY = rect.height / video.videoHeight;
            overlay.innerHTML = '';
 
            for (const det of detections) {
                // derive label (best-match or Unknown)
                let label = 'Unknown';
                if (faceMatcher) {
                    const m = faceMatcher.findBestMatch(det.descriptor);
                    if (m && m.label && m.distance < 0.7) {
                        label = m.label;
                    }
                }
                const box = det.detection.box;
                const left = Math.max(0, Math.round(box.x * scaleX));
                const top = Math.max(0, Math.round(box.y * scaleY));
                const width = Math.round(box.width * scaleX);
                const height = Math.round(box.height * scaleY);
 
                const boxEl = document.createElement('div');
                boxEl.style.cssText = `
                    position:absolute;
                    left:${left}px; top:${top}px;
                    width:${width}px; height:${height}px;
                    border:2px solid #00e676;
                    border-radius:4px;
                    box-shadow: 0 0 8px rgba(0,0,0,0.35);
                `;
                const lbl = document.createElement('div');
                const pretty = (function(){ try { const m = label && label.match(/^(.+?)\s*-\s*(.+?)\s*\((.*?)\)$/); return m ? `${m[1]} - ${m[2]}` : label; } catch(_) { return label; } })();
                lbl.textContent = pretty;
                lbl.style.cssText = `
                    position:absolute;
                    left:0; top:-22px;
                    background:rgba(0,0,0,0.65);
                    color:#fff;
                    padding:2px 6px;
                    font-size:12px;
                    border-radius:3px;
                    max-width:${Math.max(60, width)}px;
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                `;
                boxEl.appendChild(lbl);
                overlay.appendChild(boxEl);
            }
        } catch (e) {
            console.warn('overlay render failed', e);
        }

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

        // If already buffered/recorded for this session, skip
        if (recordedAttendances.has(attendanceKey)) {
            return;
        }

        // Resolve student_number from label => window.__studentsIndexByNameClass
        let studentNumber = null;
        try {
            const m = faceLabel && faceLabel.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)$/);
            if (m) {
                const cls = (m[1] || '').trim();
                const nm = (m[2] || '').trim();
                const key = `${nm}|${cls}`;
                const sidx = (typeof window !== 'undefined') ? window.__studentsIndexByNameClass : null;
                const s = sidx && sidx.get ? sidx.get(key) : null;
                if (s && s.student_number) studentNumber = String(s.student_number);
            }
        } catch (e) {
            console.warn('resolve student_number failed', e);
        }

        // Fetch historical count for this face (best-effort)
        let hist = 0;
        try {
            const cntResp = await fetch(`/api/attendance/count/${face.id}`);
            if (cntResp.ok) {
                const cntJson = await cntResp.json();
                hist = Number(cntJson.count || 0);
            }
        } catch (e) {
            console.warn('fetch count failed', e);
        }

        // If already buffered for this student in the same session, skip
        const bufKey = studentNumber ? studentNumber : `face:${face.id}`;
        if (bufferedAttendances.has(bufKey)) {
            console.log(`[缓冲去重] 本会话已存在 ${faceLabel} (${studentNumber || ('face:'+face.id)}), 跳过`);
            recordedAttendances.add(attendanceKey);
            return;
        }

        // Buffer only (do not persist immediately)
        bufferedAttendances.set(bufKey, { label: faceLabel, hist, firstSeenAt: Date.now(), face_id: face.id, student_number: studentNumber });

        // Throttle duplicates in this session
        recordedAttendances.add(attendanceKey);

        // Add to attendance log (pending upload)
        const log = document.getElementById('attendance-log');
        const item = document.createElement('div');
        item.className = 'attendance-item pending';
        const prettyLabel = (function(){ try { const m = faceLabel && faceLabel.match(/^(.+?)\s*-\s*(.+?)\s*\((.*?)\)$/); return m ? `${m[1]} - ${m[2]}` : faceLabel; } catch(_) { return faceLabel; } })();
        item.textContent = `${formatTimeCNTime(new Date())} - ${prettyLabel} 已识别，待上传（历史${hist}次）`;
        log.appendChild(item);

        // Keep only last 10 entries
        while (log.children.length > 10) {
            log.removeChild(log.firstChild);
        }

        console.log(`[缓冲考勤] ${faceLabel} 已加入缓冲（历史${hist}次），等待上传`);

        // Remove from tracking since attendance is buffered
        faceTracking.delete(face.id);
    } catch (error) {
        console.error('Error buffering attendance:', error);
    }
}

async function uploadBufferedAttendance() {
    try {
        if (!bufferedAttendances || bufferedAttendances.size === 0) {
            showMessage('没有待上传的记录', 'info');
            return;
        }
        // Create session on-demand if not created yet
        if (!currentSessionId) {
            const clsSel = document.getElementById('class-combobox') || document.getElementById('class-select');
            const crsSel = document.getElementById('course-combobox') || document.getElementById('course-select');
            const selectedClass = (pendingSessionMeta && pendingSessionMeta.class_name) || (clsSel ? (clsSel.value || clsSel.textContent || '').trim() : '');
            const selectedCourse = (pendingSessionMeta && pendingSessionMeta.course_name) || (crsSel ? (crsSel.value || crsSel.textContent || '').trim() : '');
            const startTime = (pendingSessionMeta && pendingSessionMeta.start_time) || new Date().toISOString();

            const respSession = await fetch('/api/attendance/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ class_name: selectedClass, course_name: selectedCourse, start_time: startTime })
            });
            if (!respSession.ok) {
                const errorData = await respSession.json().catch(() => ({}));
                throw new Error(`Failed to create session: ${errorData.error || respSession.statusText}`);
            }
            const sessionData = await respSession.json();

            currentSessionId = sessionData.id;
            currentSessionStartTime = startTime;
        }

        let uploaded = 0;
        const log = document.getElementById('attendance-log');
        for (const [key, item] of bufferedAttendances.entries()) {
            try {
                const payload = { session_id: currentSessionId };
                // Prefer student_number; fallback to face_id
                if (item && item.student_number) {
                    payload.student_number = String(item.student_number);
                } else if (String(key).startsWith('face:')) {
                    payload.face_id = Number(String(key).slice(5));
                } else if (/^\d/.test(String(key))) {
                    payload.student_number = String(key);
                }
                if (item && item.face_id != null && payload.face_id == null) {
                    payload.face_id = item.face_id;
                }

                const resp = await fetch('/api/attendance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (resp.ok) {
                    uploaded++;
                    const entry = document.createElement('div');
                    entry.className = 'attendance-item uploaded';
                    const prettyLabel2 = (function(){ try { const m = item.label && item.label.match(/^(.+?)\s*-\s*(.+?)\s*\((.*?)\)$/); return m ? `${m[1]} - ${m[2]}` : item.label; } catch(_) { return item.label; } })();
                    entry.textContent = `${formatTimeCNTime(new Date())} - ${prettyLabel2} ✅（历史${item.hist}次）`;
                    log.appendChild(entry);
                    while (log.children.length > 10) {
                        log.removeChild(log.firstChild);
                    }
                } else {
                    const text = await resp.text().catch(() => '');
                    console.warn('Upload attendance failed:', resp.status, text);
                }
            } catch (e) {
                console.warn('Upload one failed:', e);
            }
        }

        bufferedAttendances.clear();
        sessionSaved = uploaded > 0;
        if (uploaded > 0) {
            showMessage(`已上传 ${uploaded} 条考勤记录`, 'success');
            // Auto-refresh Reports tab for this session (SPA has the element even if hidden)
            try {
                await loadSessionsForReport();
                const sel = document.getElementById('report-session');
                if (sel) {
                    sel.value = currentSessionId;
                    await loadReport();
                }
            } catch (e) {
                console.warn('auto refresh report failed', e);
            }
        } else {
            showMessage('未上传任何记录', 'warning');
        }
    } catch (e) {
        console.error('uploadBufferedAttendance error:', e);
        showMessage('上传失败，请稍后重试', 'error');
    }
}

function getAttendanceButtons() {
    const container = document.getElementById('attendance-page') || document;
    const startBtn = container.querySelector('[data-i18n="attendance_start_btn"]');
    const stopBtn = container.querySelector('[data-i18n="attendance_stop_btn"]');
    return { startBtn, stopBtn };
}

function switchToUploadButtons() {
    const { startBtn } = getAttendanceButtons();
    if (startBtn) {
        const txt = (typeof currentLanguage !== 'undefined' && currentLanguage === 'en')
            ? 'Upload Attendance Records'
            : '上传考勤记录';
        startBtn.textContent = txt;
        startBtn.onclick = () => uploadBufferedAttendance();
    }
}

function restoreAttendanceButtons() {
    const { startBtn, stopBtn } = getAttendanceButtons();
    if (startBtn) {
        const txt = (typeof currentLanguage !== 'undefined' && currentLanguage === 'en')
            ? 'Start Attendance Session'
            : '开始考勤会话';
        startBtn.textContent = txt;
        startBtn.onclick = () => startAttendance();
    }
    if (stopBtn) {
        const txt = (typeof currentLanguage !== 'undefined' && currentLanguage === 'en')
            ? 'Stop Attendance'
            : '停止考勤';
        stopBtn.textContent = txt;
        stopBtn.onclick = () => stopAttendance();
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
                                        try {
                                            const resp = await fetch('/api/attendance', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ face_id: face.id, session_id: sessionId })
                                            });
                                            if (resp.ok) {
                                                recordedAttendances.add(attendanceKey);
                                                recognized++;
                                            } else {
                                                const text = await resp.text().catch(() => '');
                                                console.warn('Batch attendance insert failed:', resp.status, text);
                                            }
                                        } catch (e) {
                                            console.warn('Batch insert error:', e);
                                        }
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
        if (!sessionSelect) return;
        sessionSelect.innerHTML = '<option value="">Select Session</option>';
 
        (data.sessions || []).forEach(session => {
            const option = document.createElement('option');
            option.value = session.id;
            // 东八区显示
            const startStr = (typeof formatTimeCN === 'function') ? formatTimeCN(session.start_time) : (new Date(session.start_time)).toLocaleString('zh-CN');
            const endStr = session.end_time ? ((typeof formatTimeCN === 'function') ? formatTimeCN(session.end_time) : (new Date(session.end_time)).toLocaleString('zh-CN')) : '进行中';
            option.textContent = `${session.class_name}-${session.course_name}(${startStr} - ${endStr})`;
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
         const [summaryResp, attendeesResp] = await Promise.all([
             fetch(`/api/attendance/summary/${encodeURIComponent(sessionId)}`),
             fetch(`/api/attendance/session/${encodeURIComponent(sessionId)}`)
         ]);
         const summaryData = await summaryResp.json();
         const attendeesData = await attendeesResp.json().catch(() => ({ attendees: [] }));
 
         const results = document.getElementById('report-results');
         results.innerHTML = '';
 
         // Attendees list (single per student per session)
         const attendees = Array.isArray(attendeesData.attendees) ? attendeesData.attendees : [];
         const attendeesSection = document.createElement('div');
         attendeesSection.innerHTML = '<h3>本次会话出勤名单</h3>';
         if (attendees.length === 0) {
             attendeesSection.innerHTML += '<p>暂无出勤记录</p>';
         } else {
             const atbl = document.createElement('table');
             atbl.className = 'stats-table';
             atbl.innerHTML = `
                 <tr>
                     <th>学号</th>
                     <th>姓名</th>
                     <th>班级</th>
                     <th>课程</th>
                 </tr>
             `;
             attendees.forEach(a => {
                 const r = document.createElement('tr');
                 r.innerHTML = `<td>${a.student_number || ''}</td><td>${a.name || ''}</td><td>${a.class_name || ''}</td><td>${a.course_name || ''}</td>`;
                 atbl.appendChild(r);
             });
             attendeesSection.appendChild(atbl);
         }
         results.appendChild(attendeesSection);
 
         // Legacy summary (counts by face)
         const summary = Array.isArray(summaryData.summary) ? summaryData.summary : [];
         const sumSection = document.createElement('div');
         sumSection.innerHTML = '<h3>考勤统计</h3>';
         if (summary.length === 0) {
             sumSection.innerHTML += '<p>该会话暂无考勤记录</p>';
         } else {
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
             summary.forEach(item => {
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
             sumSection.appendChild(table);
         }
         results.appendChild(sumSection);
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
                // 东八区显示
                item.textContent = (typeof formatTimeCN === 'function')
                  ? formatTimeCN(record.timestamp)
                  : new Date(record.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
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
                    <th>班级</th>
                    <th>打卡次数</th>
                    <th>总会话</th>
                    <th>出勤率</th>
                </tr>
            `;

            data.details.forEach(detail => {
                const row = document.createElement('tr');
                const rateClass = detail.attendance_rate >= 80 ? 'rate-high' :
                                detail.attendance_rate >= 60 ? 'rate-medium' : 'rate-low';

                row.innerHTML = `
                    <td>${detail.name}</td>
                    <td>${detail.course || (typeof t === 'function' ? t('stats_all_courses') : '全部课程')}</td>
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
// === CN timezone helpers (global) ===
function formatTimeCN(value) {
    try {
        const d = value instanceof Date ? value : new Date(value);
        return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    } catch (e) {
        const d = value instanceof Date ? value : new Date(value);
        return d.toLocaleString('zh-CN');
    }
}
function formatTimeCNTime(value) {
    try {
        const d = value instanceof Date ? value : new Date(value);
        return d.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    } catch (e) {
        const d = value instanceof Date ? value : new Date(value);
        return d.toLocaleTimeString('zh-CN');
    }
}
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

    const hadBuffered = bufferedAttendances && bufferedAttendances.size > 0;

    try {
        // Update session with end time only if a session was actually saved (uploaded)
        if (currentSessionId && sessionSaved) {
            const endTime = new Date().toISOString();
            const response = await fetch(`/api/attendance/sessions/${currentSessionId}/end`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ end_time: endTime })
            });

            if (response.ok) {
                const data = await response.json();
                const endStr = (data && data.end_time) ? ((typeof formatTimeCN === 'function') ? formatTimeCN(data.end_time) : data.end_time) : '';
                const msg = data && data.final_session_id
                    ? `Session ended: ${data.final_session_id}`
                    : `Session ended: ${data.id}${endStr ? ' at ' + endStr : ''}`;
                console.log(msg);
            }
        } else {
            console.log('[停止考勤] 本次未上传记录，不保存会话');
        }

    } catch (error) {
        console.error('Error ending session:', error);
    }

    stopWebcam();

    // Remove HTML overlay if present
    const ov = document.getElementById('attendance-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);

    // Clear legacy canvas if exists
    const canvas = document.getElementById('attendance-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Reset attendance state
    isAttendanceRunning = false;
    currentSessionId = null;
    currentSessionStartTime = null;
    pendingSessionMeta = null;
    sessionSaved = false;

    // Clear buffered and recorded attendances for new session
    if (bufferedAttendances) bufferedAttendances.clear();
    recordedAttendances.clear();

    // Clear face tracking data
    faceTracking.clear();

    // Hide status indicator
    const statusDiv = document.getElementById('attendance-status');
    if (statusDiv) statusDiv.style.display = 'none';

    // Hide session info
    const sessionInfo = document.getElementById('current-session-info');
    if (sessionInfo) sessionInfo.style.display = 'none';

    // Restore buttons
    if (typeof restoreAttendanceButtons === 'function') restoreAttendanceButtons();

    // Log discard info if there was pending buffer
    if (hadBuffered) {
        const log = document.getElementById('attendance-log');
        if (log) {
            const item = document.createElement('div');
            item.className = 'attendance-item invalid';
            item.textContent = `${formatTimeCNTime(new Date())} - 本次缓冲的考勤记录已丢弃`;
            log.appendChild(item);
            while (log.children.length > 10) {
                log.removeChild(log.firstChild);
            }
        }
    }

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

/** Initialize when page loads */
document.addEventListener('DOMContentLoaded', async function() {
    const hasData = document.getElementById('data-page');
    const hasAttendance = document.getElementById('attendance-page');
    const hasReports = document.getElementById('reports-page');
    const hasStats = document.getElementById('statistics-page');
    const hasBatch = document.getElementById('batch-page');

    // Default to Data & Register when opening index.html (SPA)
    try {
        const valid = ['data','attendance','batch','reports','statistics'];
        const fromHash = (location.hash || '').replace('#','').trim();
        if (hasData) {
            if (fromHash && valid.includes(fromHash)) {
                showPage(fromHash);
            } else {
                showPage('data');
            }
        }
    } catch (e) {
        console.warn('Default showPage failed, fallback to unhide data-page', e);
        if (hasData) hasData.style.display = 'block';
    }

    if (hasAttendance || hasData) {
        await checkCameraPermission();
    }

    if (hasData) {
        // Data & Register needs models for face registration
        init();
        // Preload lists for a non-empty view
        if (typeof loadStudentsTable === 'function') loadStudentsTable();
        if (typeof loadCoursesTable === 'function') loadCoursesTable();
        if (typeof loadMappingsTable === 'function') loadMappingsTable();
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
        hideLegacyStatisticsBlocks();
    } else if (hasBatch) {
        // Batch page also needs models and known faces for recognition
        init();
    }

    // Hook fuzzy filters if present (attendance selects)
    try {
        const classFilter = document.getElementById('class-filter');
        if (classFilter && !classFilter.__hooked) {
            classFilter.__hooked = true;
            classFilter.addEventListener('input', () => populateClassDropdown());
        }
        const courseFilter = document.getElementById('course-filter');
        if (courseFilter && !courseFilter.__hooked) {
            courseFilter.__hooked = true;
            courseFilter.addEventListener('input', () => updateCourseOptions());
        }
    } catch (e) { console.warn('bind filter events failed', e); }
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
// Map API gender to zh display
function displayGender(g) {
    if (!g) return '';
    const v = String(g).toLowerCase();
    if (v === 'male') return '男';
    if (v === 'female') return '女';
    return v;
}
// Upload student photo blob to backend and upsert photo_path (and optional fields)
async function uploadStudentPhoto(studentNumber, name, className, gender, blob) {
    try {
        const form = new FormData();
        form.append('photo', blob, `${studentNumber || name || 'student'}.jpg`);
        form.append('student_number', studentNumber);
        if (name) form.append('name', name);
        if (className) form.append('class_name', className);
        if (gender) form.append('gender', gender);
        const resp = await fetch('/api/students/upload/photo', { method: 'POST', body: form });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            console.warn('upload_photo failed:', resp.status, txt);
        }
    } catch (e) {
        console.warn('uploadStudentPhoto error:', e);
    }
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

        // Try get default class from folder name
        let defaultClass = '';
        const first = images[0];
        if (first && first.webkitRelativePath) {
            const segs = first.webkitRelativePath.split('/').filter(Boolean);
            if (segs.length) defaultClass = segs[0];
        }
        const className = prompt('请输入班级（默认使用文件夹名称）', defaultClass) || defaultClass || '';

        setDataResults('<p>正在导入学生，请稍候...</p>');

        const form = new FormData();
        // Prepare meta map for gender/class per file
        const meta = {};
        // Accumulate faces to create (client-side descriptor -> POST /api/faces)
        const facesToCreate = [];
        // Helper: parse "学号-姓名" or "学号_姓名"
        function parseStudentFromFilenameFrontend(filename) {
            const nameWithoutExt = String(filename || '').replace(/\.[^.]+$/,'');
            let parts = nameWithoutExt.split('-');
            if (parts.length < 2) parts = nameWithoutExt.split('_');
            if (parts.length < 2) return null;
            const student_number = (parts[0] || '').trim();
            const name = (parts.slice(1).join('-') || '').trim();
            if (!student_number || !name) return null;
            return { student_number, name };
        }

        // Ensure age/gender model loaded
        if (!faceapi.nets.ageGenderNet.params) {
            await faceapi.nets.ageGenderNet.loadFromUri('/weights/');
        }

        // Detector options tuned for photos
        const detOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

        for (const file of images) {
            form.append('photos', file, file.name);
            try {
                // Detect gender per image (best-effort)
                const img = await faceapi.bufferToImage(file);
                const det = await faceapi
                    .detectSingleFace(img, detOptions)
                    .withFaceLandmarks()
                    .withFaceDescriptor()
                    .withAgeAndGender();
                const gender = det && det.gender ? det.gender : null;
                meta[file.name] = { gender, class_name: className || null };
                // Prepare a faces payload if we have a descriptor and can parse name
                try {
                    const parsed = parseStudentFromFilenameFrontend(file.name);
                    if (det && det.descriptor && parsed && parsed.name) {
                        facesToCreate.push({
                            label: `${className}-${parsed.name}-`,
                            descriptors: Array.from(det.descriptor),
                            class: className || '',
                            name: parsed.name,
                            course: ''
                        });
                    }
                } catch (_) {}
            } catch (err) {
                console.warn('Gender detect failed for', file.name, err?.message || err);
                meta[file.name] = { gender: null, class_name: className || null };
            }
        }
        form.append('class_name', className || '');
        form.append('meta', JSON.stringify(meta));

        const resp = await fetch('/api/students/import/photos', {
            method: 'POST',
            body: form
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(err || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        // After student rows are inserted/updated, create faces to enable recognition immediately
        let createdFaces = 0;
        for (const f of facesToCreate) {
            try {
                const r = await fetch('/api/faces', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(f)
                });
                if (r.ok) createdFaces++;
            } catch (e) {
                console.warn('create face failed:', e);
            }
        }

        showMessage(`学生导入完成：插入 ${data.inserted}，更新 ${data.updated}，跳过 ${data.skipped}`, 'success');
        setDataResults(`
            <h4>学生导入结果</h4>
            <ul>
              <li>处理总数: ${data.processed}</li>
              <li>插入: ${data.inserted}</li>
              <li>更新: ${data.updated}</li>
              <li>跳过: ${data.skipped}</li>
              <li>生成可识别面部: ${createdFaces} / ${facesToCreate.length}</li>
            </ul>
            ${data.errors && data.errors.length ? ('<h5>错误列表</h5>' + jsonPre(data.errors)) : ''}
        `);
        // Refresh FaceMatcher so new faces can be recognized right away
        try { await loadKnownFaces(); } catch (e) { console.warn('loadKnownFaces after import failed', e); }
        // Optionally refresh current table
        if (typeof loadStudentsTable === 'function') loadStudentsTable();
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

        // Optional: upload manual photo if provided
        try {
            const photoEl = document.getElementById('student-photo-input');
            const file = photoEl && photoEl.files && photoEl.files[0];
            if (file) {
                await uploadStudentPhoto(sn, name, null, gender, file);
            }
        } catch (e) {
            console.warn('manual photo upload failed:', e);
        }

        showMessage('学生创建成功', 'success');
        setDataResults(`<h4>新建学生</h4>${jsonPre(data.student || data)}`);

        // Clear inputs
        document.getElementById('student-number-input').value = '';
        document.getElementById('student-name-input').value = '';
        document.getElementById('student-gender-input').value = '';
        const photoEl2 = document.getElementById('student-photo-input');
        if (photoEl2) photoEl2.value = '';

        if (typeof loadStudentsTable === 'function') loadStudentsTable();
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

// ====== Data & Register: Lists (students/courses/mappings) ======
async function loadStudentsTable() {
    const resp = await fetch('/api/students');
    const data = await resp.json();
    // Be tolerant of different response shapes
    const list = Array.isArray(data) ? data : (data.students || data.rows || data.data || []);
    window.__studentsCache = list;
    const f = document.getElementById('students-filter');
    renderStudentsTable(window.__studentsCache, f ? f.value : '');
}
function renderStudentsTable(list, filterText) {
    const host = document.getElementById('students-table');
    if (!host) return;
    host.innerHTML = '';
    const text = (filterText || '').toLowerCase();
    const rows = (list || []).filter(s => (`${s.student_number} ${s.name} ${s.class_name || ''}`).toLowerCase().includes(text));
    if (rows.length === 0) { host.innerHTML = '<p>暂无学生</p>'; return; }
    const tbl = document.createElement('table'); tbl.className = 'stats-table';
    tbl.innerHTML = `<tr><th>学号</th><th>姓名</th><th>班级</th><th>性别</th><th>照片</th><th>创建时间</th><th>操作</th></tr>`;
    rows.forEach(s => {
        const tr = document.createElement('tr');
        const photo = s.photo_path ? `<a href="${s.photo_path}" target="_blank">查看</a>` : '';
        tr.innerHTML = `<td>${s.student_number||''}</td><td>${s.name||''}</td><td>${s.class_name||''}</td><td>${displayGender(s.gender)||''}</td><td>${photo}</td><td>${ (typeof formatTimeCN === 'function') ? formatTimeCN(s.created_at) : (s.created_at||'') }</td><td><button onclick="deleteStudent(${s.id})">删除</button></td>`;
        tbl.appendChild(tr);
    });
    host.appendChild(tbl);
}
async function deleteStudent(id) {
    if (!confirm('确认删除该学生？')) return;
    const resp = await fetch(`/api/students/${id}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok) { showMessage(data.error || '删除失败', 'error'); return; }
    showMessage('已删除学生', 'success');
    loadStudentsTable();
}

async function loadCoursesTable() {
    const resp = await fetch('/api/courses');
    const data = await resp.json();
    // Be tolerant of different response shapes
    const list = Array.isArray(data) ? data : (data.courses || data.rows || data.data || []);
    window.__coursesCache = list;
    const f = document.getElementById('courses-filter');
    renderCoursesTable(window.__coursesCache, f ? f.value : '');
}
function renderCoursesTable(list, filterText) {
    const host = document.getElementById('courses-table'); if (!host) return; host.innerHTML='';
    const text=(filterText||'').toLowerCase();
    const rows=(list||[]).filter(c => (`${c.course_code} ${c.course_name}`).toLowerCase().includes(text));
    if(rows.length===0){ host.innerHTML='<p>暂无课程</p>'; return; }
    const tbl=document.createElement('table'); tbl.className='stats-table';
    tbl.innerHTML = `<tr><th>课程编号</th><th>课程名称</th><th>学时</th><th>创建时间</th><th>操作</th></tr>`;
    rows.forEach(c => {
        const tr=document.createElement('tr');
        tr.innerHTML = `<td>${c.course_code}</td><td>${c.course_name}</td><td>${c.course_hours ?? ''}</td><td>${ (typeof formatTimeCN === 'function') ? formatTimeCN(c.created_at) : (c.created_at||'') }</td><td><button onclick="deleteCourse(${c.id})">删除</button></td>`;
        tbl.appendChild(tr);
    });
    host.appendChild(tbl);
}
async function deleteCourse(id){
    if(!confirm('确认删除该课程？')) return;
    const resp=await fetch(`/api/courses/${id}`, { method:'DELETE' });
    const data=await resp.json();
    if(!resp.ok){ showMessage(data.error||'删除失败','error'); return; }
    showMessage('已删除课程','success');
    loadCoursesTable();
}

async function loadMappingsTable(){
    const resp=await fetch('/api/course-students');
    const data=await resp.json();
    window.__mappingsCache = data.mappings || [];
    const f=document.getElementById('mappings-filter');
    renderMappingsTable(window.__mappingsCache, f?f.value:'');
}
function renderMappingsTable(list, filterText){
    const host=document.getElementById('mappings-table'); if(!host) return; host.innerHTML='';
    const text=(filterText||'').toLowerCase();
    const rows=(list||[]).filter(m => (`${m.student_number} ${m.name} ${m.course_code} ${m.course_name}`).toLowerCase().includes(text));
    if(rows.length===0){ host.innerHTML='<p>暂无映射</p>'; return; }
    const tbl=document.createElement('table'); tbl.className='stats-table';
    tbl.innerHTML = `<tr><th>学号</th><th>姓名</th><th>课程名称</th><th>课程编号</th><th>创建时间</th><th>操作</th></tr>`;
    rows.forEach(m => {
        const tr=document.createElement('tr');
        tr.innerHTML = `<td>${m.student_number}</td><td>${m.name}</td><td>${m.course_name}</td><td>${m.course_code}</td><td>${ (typeof formatTimeCN === 'function') ? formatTimeCN(m.created_at) : (m.created_at||'') }</td><td><button onclick="deleteMapping(${m.id})">删除</button></td>`;
        tbl.appendChild(tr);
    });
    host.appendChild(tbl);
}
async function deleteMapping(id){
    if(!confirm('确认删除该映射？')) return;
    const resp=await fetch(`/api/course-students/${id}`, { method:'DELETE' });
    const data=await resp.json();
    if(!resp.ok){ showMessage(data.error||'删除失败','error'); return; }
    showMessage('已删除映射','success');
    loadMappingsTable();
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
