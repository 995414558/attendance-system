// Internationalization (i18n) system
const translations = {
    'zh': {
        // Navigation
        'nav_title': '面部考勤系统',
        'nav_register': '注册面部',
        'nav_attendance': '考勤',
        'nav_batch': '批量处理',
        'nav_reports': '报告',
        'nav_statistics': '统计',

        // Register Page
        'register_title': '注册学生面部',
        'register_class': '班级:',
        'register_name': '姓名:',
        'register_course': '课程:',
        'register_webcam_btn': '启动摄像头注册',
        'register_upload_btn': '选择图片文件',
        'register_capture_btn': '捕获面部',

        // Attendance Page
        'attendance_title': '考勤',
        'attendance_session': '会话ID:',
        'attendance_start_btn': '开始考勤会话',
        'attendance_stop_btn': '停止考勤',
        'attendance_log_title': '考勤记录',

        // Batch Page
        'batch_title': '批量考勤处理',
        'batch_select_files': '选择图片文件',
        'batch_processing': '正在处理...',
        'batch_completed': '处理完成',

        // Reports Page
        'reports_title': '考勤报告',
        'reports_session': '会话ID:',
        'reports_load_btn': '加载报告',
        'reports_table_student': '学生',
        'reports_table_class': '班级',
        'reports_table_course': '课程',
        'reports_table_count': '考勤次数',

        // Statistics Page
        'stats_title': '统计分析',
        'stats_by_course': '按课程统计',
        'stats_by_class': '按班级统计',
        'stats_total_students': '总学生数',
        'stats_total_sessions': '总会话数',
        'stats_avg_attendance': '平均出勤率',

        // Messages
        'msg_loading_models': '正在加载面部识别模型...',
        'msg_models_loaded': '系统初始化完成！',
        'msg_webcam_started': '摄像头已启动，请面对镜头',
        'msg_face_captured': '人脸捕获成功！正在注册...',
        'msg_registration_success': '学生注册成功！',
        'msg_no_face_detected': '未检测到人脸，请调整位置后重试',
        'msg_attendance_started': '考勤系统已启动',
        'msg_models_not_loaded': '模型尚未加载完成，请稍候',
        'msg_no_image_selected': '请选择一张图片',
        'msg_processing_image': '正在处理图片...',
        'msg_network_error': '网络错误，请重试',
        'msg_fill_info': '请填写完整的学生信息',
        'msg_enter_session': '请输入会话ID',
        'msg_load_report_error': '加载报告失败',

        // Data & Register (merged tab)
        'nav_data_register': '数据与注册',
        'data_title': '数据管理',
        'data_face_reg_title': '面部注册',
        'hint_face_reg_merged': '该功能已合并到“数据与注册”页，请在该页面使用。',
        'hint_register_image': '也可以上传单张图片进行注册。',
        'data_students_title': '学生',
        'label_student_folder': '从文件夹导入',
        'btn_import_students': '导入学生',
        'hint_student_folder': '使用方法：点击“选择文件”，选择包含学生照片的文件夹。文件命名格式：学号-姓名.jpg/png，例如 20230001-张三.jpg',
        'label_manual_create': '手工创建：',
        'placeholder_gender': '性别',
        'gender_male': '男',
        'gender_female': '女',
        'gender_other': '其他',
        'btn_create_student': '创建学生',
        'hint_student_note': '说明：学生支持按文件名格式从文件夹导入，无需Excel。',
        'data_courses_title': '课程',
        'label_courses_excel': '从Excel导入（课程编号/课程名称/课程学时）',
        'btn_import_courses': '导入课程',
        'hint_course_excel': 'Excel必须包含列：课程编号、课程名称、课程学时。也支持英文列名：course_code、course_name、course_hours。',
        'hint_course_excel_example_title': '示例：',
        'data_mappings_title': '课程-学生映射',
        'label_mappings_excel': '从Excel导入（学号 + 课程编号）',
        'btn_import_mappings': '导入映射',
        'hint_mapping_excel': 'Excel必须包含列：学号/student_number、课程编号/course_code。若学号或课程编号不存在，结果会标记错误，请先添加。',
        'hint_mapping_excel_example_title': '示例：',
        'btn_add_mapping': '添加映射',

        // Language
        'lang_switch': 'English'
    },
    'en': {
        // Navigation
        'nav_title': 'Face Attendance System',
        'nav_register': 'Register Faces',
        'nav_attendance': 'Take Attendance',
        'nav_batch': 'Batch Processing',
        'nav_reports': 'Reports',
        'nav_statistics': 'Statistics',

        // Register Page
        'register_title': 'Register Student Faces',
        'register_class': 'Class:',
        'register_name': 'Name:',
        'register_course': 'Course:',
        'register_webcam_btn': 'Start Webcam Registration',
        'register_upload_btn': 'Choose Image File',
        'register_capture_btn': 'Capture Face',

        // Attendance Page
        'attendance_title': 'Take Attendance',
        'attendance_session': 'Session ID:',
        'attendance_start_btn': 'Start Attendance Session',
        'attendance_stop_btn': 'Stop Attendance',
        'attendance_log_title': 'Attendance Log',

        // Batch Page
        'batch_title': 'Batch Attendance Processing',
        'batch_select_files': 'Select Image Files',
        'batch_processing': 'Processing...',
        'batch_completed': 'Processing Completed',

        // Reports Page
        'reports_title': 'Attendance Reports',
        'reports_session': 'Session ID:',
        'reports_load_btn': 'Load Report',
        'reports_table_student': 'Student',
        'reports_table_class': 'Class',
        'reports_table_course': 'Course',
        'reports_table_count': 'Attendance Count',

        // Statistics Page
        'stats_title': 'Statistics Analysis',
        'stats_by_course': 'Statistics by Course',
        'stats_by_class': 'Statistics by Class',
        'stats_total_students': 'Total Students',
        'stats_total_sessions': 'Total Sessions',
        'stats_avg_attendance': 'Average Attendance',

        // Messages
        'msg_loading_models': 'Loading face recognition models...',
        'msg_models_loaded': 'System initialization completed!',
        'msg_webcam_started': 'Webcam started, please face the camera',
        'msg_face_captured': 'Face captured successfully! Registering...',
        'msg_registration_success': 'Student registration successful!',
        'msg_no_face_detected': 'No face detected, please adjust position and try again',
        'msg_attendance_started': 'Attendance system started',
        'msg_models_not_loaded': 'Models not loaded yet, please wait',
        'msg_no_image_selected': 'Please select an image',
        'msg_processing_image': 'Processing image...',
        'msg_network_error': 'Network error, please try again',
        'msg_fill_info': 'Please fill in complete student information',
        'msg_enter_session': 'Please enter Session ID',
        'msg_load_report_error': 'Failed to load report',

        // Data & Register (merged tab)
        'nav_data_register': 'Data & Register',
        'data_title': 'Data Management',
        'data_face_reg_title': 'Face Registration',
        'hint_face_reg_merged': 'This feature has been merged into the Data & Register tab.',
        'hint_register_image': 'You can also upload a single image to register.',
        'data_students_title': 'Students',
        'label_student_folder': 'Import from Folder',
        'btn_import_students': 'Import Students',
        'hint_student_folder': 'How to use: click “Choose File” and select the folder containing student photos. Filename format: studentNumber-name.jpg/png, e.g. 20230001-ZhangSan.jpg',
        'label_manual_create': 'Manual Create:',
        'placeholder_gender': 'Gender',
        'gender_male': 'Male',
        'gender_female': 'Female',
        'gender_other': 'Other',
        'btn_create_student': 'Create Student',
        'hint_student_note': 'Note: Students are imported via folder by filename format; Excel is not required.',
        'data_courses_title': 'Courses',
        'label_courses_excel': 'Import from Excel (course_code/course_name/course_hours)',
        'btn_import_courses': 'Import Courses',
        'hint_course_excel': 'Excel must include columns: 课程编号, 课程名称, 课程学时. English headers also supported: course_code, course_name, course_hours.',
        'hint_course_excel_example_title': 'Example:',
        'data_mappings_title': 'Course-Students Mapping',
        'label_mappings_excel': 'Import from Excel (student_number + course_code)',
        'btn_import_mappings': 'Import Mappings',
        'hint_mapping_excel': 'Excel must include: 学号/student_number and 课程编号/course_code. If either does not exist, the result will contain an error for that row.',
        'hint_mapping_excel_example_title': 'Example:',
        'btn_add_mapping': 'Add Mapping',

        // Language
        'lang_switch': '中文'
    }
};

// Current language
let currentLanguage = localStorage.getItem('language') || 'zh';

// Get translation
function t(key) {
    return translations[currentLanguage][key] || key;
}

// Set language
function setLanguage(lang) {
    if (translations[lang]) {
        currentLanguage = lang;
        localStorage.setItem('language', lang);
        updateUI();
    }
}

// Update all UI elements with translations
function updateUI() {
    // Update navigation
    document.querySelector('nav h1').textContent = t('nav_title');
    document.querySelectorAll('nav a')[0].textContent = t('nav_data_register');
    document.querySelectorAll('nav a')[1].textContent = t('nav_attendance');
    document.querySelectorAll('nav a')[2].textContent = t('nav_batch');
    document.querySelectorAll('nav a')[3].textContent = t('nav_reports');
    document.querySelectorAll('nav a')[4].textContent = t('nav_statistics');

    // Update elements with data-i18n attributes
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (key && translations[currentLanguage][key]) {
            element.textContent = t(key);
        }
    });

    // Update page titles
    const registerTitle = document.querySelector('#register-page h2');
    if (registerTitle) registerTitle.textContent = t('data_face_reg_title');

    const attendanceTitle = document.querySelector('#attendance-page h2');
    if (attendanceTitle) attendanceTitle.textContent = t('attendance_title');

    const batchTitle = document.querySelector('#batch-page h2');
    if (batchTitle) batchTitle.textContent = t('batch_title');

    const reportsTitle = document.querySelector('#reports-page h2');
    if (reportsTitle) reportsTitle.textContent = t('reports_title');

    const statisticsTitle = document.querySelector('#statistics-page h2');
    if (statisticsTitle) statisticsTitle.textContent = t('stats_title');

    // Update form labels
    const classLabels = document.querySelectorAll('label[for*="class"], label[for*="student-class"]');
    classLabels.forEach(label => label.textContent = t('register_class'));

    const nameLabels = document.querySelectorAll('label[for*="name"], label[for*="student-name"]');
    nameLabels.forEach(label => label.textContent = t('register_name'));

    const courseLabels = document.querySelectorAll('label[for*="course"], label[for*="student-course"]');
    courseLabels.forEach(label => label.textContent = t('register_course'));

    // Update buttons
    const webcamBtn = document.querySelector('button[onclick*="startWebcamRegistration"]');
    if (webcamBtn) webcamBtn.textContent = t('register_webcam_btn');

    const captureBtn = document.getElementById('capture-btn');
    if (captureBtn) captureBtn.textContent = t('register_capture_btn');

    const attendanceBtn = document.querySelector('button[onclick*="startAttendance"]');
    if (attendanceBtn) attendanceBtn.textContent = t('attendance_start_btn');

    const stopBtn = document.querySelector('button[onclick*="stopAttendance"]');
    if (stopBtn) stopBtn.textContent = t('attendance_stop_btn');

    // Update statistics labels
    const statLabels = document.querySelectorAll('.stat-label');
    if (statLabels.length >= 4) {
        statLabels[0].textContent = t('stats_total_students');
        statLabels[1].textContent = t('stats_total_sessions');
        statLabels[2].textContent = t('stats_total_attendance');
        statLabels[3].textContent = t('stats_avg_attendance');
    }

    // Update language switch button
    const langBtn = document.getElementById('lang-switch');
    if (langBtn) langBtn.textContent = t('lang_switch');
}

// Initialize i18n
document.addEventListener('DOMContentLoaded', function() {
    // Add language switch button to navigation
    const nav = document.querySelector('nav .nav-container');
    const langBtn = document.createElement('button');
    langBtn.id = 'lang-switch';
    langBtn.textContent = t('lang_switch');
    langBtn.style.cssText = 'margin-left: auto; padding: 5px 10px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;';
    langBtn.onclick = () => setLanguage(currentLanguage === 'zh' ? 'en' : 'zh');
    nav.appendChild(langBtn);

    // Initial UI update
    updateUI();
});