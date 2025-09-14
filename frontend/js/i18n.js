// Internationalization (i18n) system
const translations = {
  zh: {
    // Navigation
    nav_title: '面部考勤系统',
    nav_data_register: '数据与注册',
    nav_attendance: '考勤',
    nav_reports: '报告',
    nav_statistics: '统计',

    // Register / Attendance
    register_title: '注册学生面部',
    register_class: '班级:',
    register_name: '姓名:',
    register_course: '课程:',
    register_webcam_btn: '启动摄像头注册',
    register_upload_btn: '选择图片文件',
    register_capture_btn: '捕获面部',

    attendance_title: '考勤',
    attendance_session: '会话ID:',
    attendance_start_btn: '开始考勤会话',
    attendance_stop_btn: '停止考勤',
    attendance_log_title: '考勤记录',

    // Reports
    reports_title: '考勤报告',
    reports_session: '会话ID:',
    reports_load_btn: '加载报告',
    reports_table_student: '学生',
    reports_table_class: '班级',
    reports_table_course: '课程',
    reports_table_count: '考勤次数',

    // Statistics
    stats_title: '统计分析',
    stats_overall_title: '总体统计',
    stats_by_course: '按课程统计',
    stats_by_class: '按班级统计',
    stats_students_tab: '学生',
    stats_total_students: '总学生数',
    stats_total_sessions: '总会话数',
    stats_total_attendance: '总考勤',
    stats_avg_attendance: '平均出勤率',
    stats_course_header: '课程',
    stats_class_header: '班级',
    stats_name_header: '姓名',
    stats_courses_header: '课程数',
    stats_attended_header: '出勤次数',
    stats_attendance_count_header: '打卡次数',
    stats_attendance_rate_header: '出勤率',
    stats_no_course_data: '暂无课程统计数据',
    stats_no_class_data: '暂无班级统计数据',
    stats_no_student_data: '暂无学生统计数据',
    stats_no_detail_data: '暂无学生考勤数据',
    stats_course_summary: '课程: {0} | 学生: {1} | 平均: {2}%',
    stats_student_summary: '学生: {0} | 课程: {1} | 平均: {2}%',
    stats_detail_summary: '课程: {0} | 出勤: {1} | 总会话: {2} | 平均: {3}%',

    // Messages
    msg_loading_models: '正在加载面部识别模型...',
    msg_models_loaded: '系统初始化完成！',
    msg_webcam_started: '摄像头已启动，请面对镜头',
    msg_face_captured: '人脸捕获成功！正在注册...',
    msg_registration_success: '学生注册成功',
    msg_no_face_detected: '未检测到人脸，请调整位置后重试',
    msg_attendance_started: '考勤系统已启动',
    msg_models_not_loaded: '模型尚未加载完成，请稍候',
    msg_no_image_selected: '请选择一张图片',
    msg_processing_image: '正在处理图片...',
    msg_network_error: '网络错误，请重试',
    msg_fill_info: '请填写完整的学生信息',
    msg_enter_session: '请输入会话ID',
    msg_load_report_error: '加载报告失败',

    // Data & Register
    data_title: '数据管理',
    data_face_reg_title: '面部注册',
    hint_face_reg_merged: '该功能已合并到“数据与注册”页。',
    hint_register_image: '也可以上传单张图片进行注册。',
    data_students_title: '学生',
    label_student_folder: '从文件夹导入',
    btn_import_students: '导入学生',
    hint_student_folder: '用法：选择包含学生照片的文件夹。文件命名：学号-姓名.jpg/png。',
    label_manual_create: '手工创建：',
    placeholder_gender: '性别',
    gender_male: '男',
    gender_female: '女',
    gender_other: '其他',
    btn_create_student: '创建学生',
    hint_student_note: '说明：支持按文件名格式从文件夹导入，无需 Excel。',
    data_courses_title: '课程',
    label_courses_excel: '从 Excel 导入（课程编号/课程名称/课程学时）',
    btn_import_courses: '导入课程',
    hint_course_excel: 'Excel 必须包含：课程编号、课程名称、课程学时（或英文列名）。',
    hint_course_excel_example_title: '示例：',
    data_mappings_title: '课程-学生映射',
    label_mappings_excel: '从 Excel 导入（学号 + 课程编号）',
    btn_import_mappings: '导入映射',
    hint_mapping_excel: 'Excel 必须包含：学号/student_number、课程编号/course_code。',
    hint_mapping_excel_example_title: '示例：',
    btn_add_mapping: '添加映射',

    // Language
    lang_switch: 'English',
  },
  en: {
    nav_title: 'Face Attendance System',
    nav_data_register: 'Data & Register',
    nav_attendance: 'Take Attendance',
    nav_reports: 'Reports',
    nav_statistics: 'Statistics',

    register_title: 'Register Student Faces',
    register_class: 'Class:',
    register_name: 'Name:',
    register_course: 'Course:',
    register_webcam_btn: 'Start Webcam Registration',
    register_upload_btn: 'Choose Image File',
    register_capture_btn: 'Capture Face',

    attendance_title: 'Take Attendance',
    attendance_session: 'Session ID:',
    attendance_start_btn: 'Start Attendance Session',
    attendance_stop_btn: 'Stop Attendance',
    attendance_log_title: 'Attendance Log',

    reports_title: 'Attendance Reports',
    reports_session: 'Session ID:',
    reports_load_btn: 'Load Report',
    reports_table_student: 'Student',
    reports_table_class: 'Class',
    reports_table_course: 'Course',
    reports_table_count: 'Attendance Count',

    stats_title: 'Statistics Analysis',
    stats_overall_title: 'Overall Statistics',
    stats_by_course: 'By Course',
    stats_by_class: 'By Class',
    stats_students_tab: 'Students',
    stats_total_students: 'Total Students',
    stats_total_sessions: 'Total Sessions',
    stats_total_attendance: 'Total Attendance',
    stats_avg_attendance: 'Average Attendance',
    stats_course_header: 'Course',
    stats_class_header: 'Class',
    stats_name_header: 'Name',
    stats_courses_header: 'Courses',
    stats_attended_header: 'Attended',
    stats_attendance_count_header: 'Attendance Count',
    stats_attendance_rate_header: 'Attendance Rate',
    stats_no_course_data: 'No course statistics available',
    stats_no_class_data: 'No class statistics available',
    stats_no_student_data: 'No student statistics available',
    stats_no_detail_data: 'No attendance data available',
    stats_course_summary: 'Courses: {0} | Students: {1} | Avg: {2}%',
    stats_student_summary: 'Students: {0} | Courses: {1} | Avg: {2}%',
    stats_detail_summary: 'Courses: {0} | Attended: {1} | Total Sessions: {2} | Avg: {3}%',

    msg_loading_models: 'Loading face recognition models...',
    msg_models_loaded: 'System initialization completed!',
    msg_webcam_started: 'Webcam started, please face the camera',
    msg_face_captured: 'Face captured successfully! Registering...',
    msg_registration_success: 'Student registration successful!',
    msg_no_face_detected: 'No face detected, please adjust position and try again',
    msg_attendance_started: 'Attendance system started',
    msg_models_not_loaded: 'Models not loaded yet, please wait',
    msg_no_image_selected: 'Please select an image',
    msg_processing_image: 'Processing image...',
    msg_network_error: 'Network error, please try again',
    msg_fill_info: 'Please fill in complete student information',
    msg_enter_session: 'Please enter Session ID',
    msg_load_report_error: 'Failed to load report',

    nav_batch: 'Batch Processing',
    data_title: 'Data Management',
    data_face_reg_title: 'Face Registration',
    hint_face_reg_merged: 'This feature has been merged into the Data & Register tab.',
    hint_register_image: 'You can also upload a single image to register.',
    data_students_title: 'Students',
    label_student_folder: 'Import from Folder',
    btn_import_students: 'Import Students',
    hint_student_folder: 'How to use: click “Choose File” and select the folder containing student photos. Filename format: studentNumber-name.jpg/png, e.g. 20230001-ZhangSan.jpg',
    label_manual_create: 'Manual Create:',
    placeholder_gender: 'Gender',
    gender_male: 'Male',
    gender_female: 'Female',
    gender_other: 'Other',
    btn_create_student: 'Create Student',
    hint_student_note: 'Note: Students are imported via folder by filename format; Excel is not required.',
    data_courses_title: 'Courses',
    label_courses_excel: 'Import from Excel (course_code/course_name/course_hours)',
    btn_import_courses: 'Import Courses',
    hint_course_excel: 'Excel must include columns: 课程编号, 课程名称, 课程学时. English headers also supported: course_code, course_name, course_hours.',
    hint_course_excel_example_title: 'Example:',
    data_mappings_title: 'Course-Students Mapping',
    label_mappings_excel: 'Import from Excel (student_number + course_code)',
    btn_import_mappings: 'Import Mappings',
    hint_mapping_excel: 'Excel must include: 学号/student_number and 课程编号/course_code. If either does not exist, the result will contain an error for that row.',
    hint_mapping_excel_example_title: 'Example:',
    btn_add_mapping: 'Add Mapping',

    lang_switch: '中文',
  }
};

// Current language
let currentLanguage = localStorage.getItem('language') || 'zh';

// Get translation
function t(key) {
  return (translations[currentLanguage] && translations[currentLanguage][key]) || key;
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
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit')) {
      el.value = val;
    } else {
      el.textContent = val;
    }
  });
  const navTitle = document.querySelector('nav h1');
  if (navTitle) navTitle.textContent = t('nav_title');
}

/** Initialize i18n + inject logo */
document.addEventListener('DOMContentLoaded', function() {
  const nav = document.querySelector('nav .nav-container');

  // Inject brand wrapper with logo + title
  if (nav) {
    let brand = nav.querySelector('.brand');
    const navTitle = nav.querySelector('h1');
    if (!brand && navTitle) {
      brand = document.createElement('div');
      brand.className = 'brand';
      const logo = document.createElement('img');
      logo.id = 'site-logo';
      logo.className = 'site-logo';
      logo.src = 'img/logo.png'; // place your logo at attendance-system/frontend/img/logo.png
      logo.alt = 'Logo';
      brand.appendChild(logo);
      nav.insertBefore(brand, navTitle);
      brand.appendChild(navTitle);
    } else if (brand && !brand.querySelector('#site-logo')) {
      const logo = document.createElement('img');
      logo.id = 'site-logo';
      logo.className = 'site-logo';
      logo.src = 'img/logo.png';
      logo.alt = 'Logo';
      brand.insertBefore(logo, brand.firstChild);
    }
  }

  // Add language switch button into nav menu (as last menu item)
  if (nav && !document.getElementById('lang-switch')) {
    const langBtn = document.createElement('button');
    langBtn.id = 'lang-switch';
    langBtn.textContent = t('lang_switch');
    langBtn.style.cssText = 'padding: 5px 10px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;';
    langBtn.onclick = () => setLanguage(currentLanguage === 'zh' ? 'en' : 'zh');
    const ul = nav.querySelector('ul');
    if (ul) {
      const li = document.createElement('li');
      li.appendChild(langBtn);
      ul.appendChild(li);
    } else {
      nav.appendChild(langBtn);
    }
  }

  // Ensure favicon link exists
  try {
    const head = document.head || document.getElementsByTagName('head')[0];
    if (head && !document.querySelector('link[rel="icon"]')) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      link.href = 'img/logo.png';
      head.appendChild(link);
    }
  } catch (e) { console.warn('favicon inject failed:', e); }

  updateUI();
});
