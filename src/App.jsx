import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, Timestamp, setDoc } from 'firebase/firestore';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// ==================================================================================================
// --- GLOBAL CONTEXTS & HELPERS ---
// ==================================================================================================

// Notification Context for Toast messages
const NotificationContext = createContext();

// Custom hook to provide notification functionality
const useNotification = () => {
  return useContext(NotificationContext);
};

// Toast Notification component
const Toast = ({ message, type, id, onClose }) => {
  const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';

  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, 5000); // Auto-close after 5 seconds
    return () => clearTimeout(timer);
  }, [id, onClose]);

  return (
    <div className={`flex items-center ${bgColor} text-white text-sm font-bold px-4 py-3 rounded-lg shadow-lg mb-2`}>
      <span className="ml-2 text-xl">{icon}</span>
      <span>{message}</span>
      <button onClick={() => onClose(id)} className="ml-auto text-white hover:text-gray-200 focus:outline-none">
        &times;
      </button>
    </div>
  );
};

// ToastContainer component to render all active toasts
const ToastContainer = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const notification = { addToast };

  return (
    <NotificationContext.Provider value={notification}>
      <div className="fixed top-4 right-4 z-[100] w-72">
        {toasts.map(toast => (
          <Toast key={toast.id} id={toast.id} message={toast.message} type={toast.type} onClose={removeToast} />
        ))}
      </div>
      {children}
    </NotificationContext.Provider>
  );
};

// Helper function to export data to CSV format
const exportToCsv = (filename, rows, addToast) => {
  if (!rows || rows.length === 0) {
    addToast("لا توجد بيانات لتصديرها.", "info");
    return;
  }

  const header = Object.keys(rows[0]).join(',');
  const csv = [
    header,
    ...rows.map(row => Object.values(row).map(value => {
      let processedValue = String(value).replace(/"/g, '""');
      if (processedValue.includes(',') || processedValue.includes('\n')) {
        processedValue = `"${processedValue}"`;
      }
      return processedValue;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast("تم تصدير البيانات بنجاح!", "success");
  } else {
    addToast("متصفحك لا يدعم تصدير الملفات.", "error");
  }
};

// Custom Hook for Firestore operations
const useFirestore = (db, isAuthReady, collectionName, addToast) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!db || !isAuthReady) {
      setLoading(false);
      return;
    }

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const collectionRef = collection(db, `artifacts/${appId}/public/data/${collectionName}`);

    const unsubscribe = onSnapshot(collectionRef, (snapshot) => {
      const fetchedData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setData(fetchedData);
      setLoading(false);
    }, (err) => {
      console.error(`Error fetching ${collectionName}:`, err);
      setError(err);
      setLoading(false);
      addToast(`خطأ في جلب بيانات ${collectionName}: ${err.message}`, "error");
    });

    return () => unsubscribe();
  }, [db, isAuthReady, collectionName, addToast]);

  const addDocument = useCallback(async (newDoc) => {
    if (!db) { addToast("قاعدة البيانات غير مهيأة.", "error"); return; }
    setLoading(true);
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const colRef = collection(db, `artifacts/${appId}/public/data/${collectionName}`);
      const docRef = await addDoc(colRef, { ...newDoc, createdAt: Timestamp.now() });
      addToast("تمت الإضافة بنجاح!", "success");
      return docRef.id;
    } catch (e) {
      console.error(`Error adding document to ${collectionName}:`, e);
      addToast(`خطأ في إضافة ${collectionName}: ${e.message}`, "error");
      setError(e);
      return null;
    } finally {
      setLoading(false);
    }
  }, [db, collectionName, addToast]);

  const updateDocument = useCallback(async (id, updatedData) => {
    if (!db) { addToast("قاعدة البيانات غير مهيأة.", "error"); return; }
    setLoading(true);
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const docRef = doc(db, `artifacts/${appId}/public/data/${collectionName}`, id);
      await updateDoc(docRef, { ...updatedData, updatedAt: Timestamp.now() });
      addToast("تم التحديث بنجاح!", "success");
    } catch (e) {
      console.error(`Error updating document in ${collectionName}:`, e);
      addToast(`خطأ في تحديث ${collectionName}: ${e.message}`, "error");
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [db, collectionName, addToast]);

  const deleteDocument = useCallback(async (id) => {
    if (!db) { addToast("قاعدة البيانات غير مهيأة.", "error"); return; }
    setLoading(true);
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const docRef = doc(db, `artifacts/${appId}/public/data/${collectionName}`, id);
      await deleteDoc(docRef);
      addToast("تم الحذف بنجاح!", "success");
    } catch (e) {
      console.error(`Error deleting document from ${collectionName}:`, e);
      addToast(`خطأ في حذف ${collectionName}: ${e.message}`, "error");
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [db, collectionName, addToast]);

  return { data, loading, error, addDocument, updateDocument, deleteDocument };
};

// ==================================================================================================
// --- COMPONENTS ---
// ==================================================================================================

// ConfirmModal component: A generic modal for user confirmation.
const ConfirmModal = ({ message, onConfirm, onCancel }) => {
  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-sm text-center">
        <h3 className="text-xl font-semibold mb-6 text-gray-800">تأكيد الإجراء</h3>
        <p className="mb-8 text-gray-700">{message}</p>
        <div className="flex justify-center space-x-4">
          <button
            onClick={onCancel}
            className="px-6 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
          >
            إلغاء
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-2 bg-red-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 rounded-md"
          >
            تأكيد
          </button>
        </div>
      </div>
    </div>
  );
};

// LoadingSpinner component: A simple loading spinner.
const LoadingSpinner = () => (
  <div className="fixed inset-0 bg-gray-200 bg-opacity-75 flex items-center justify-center z-50">
    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
    <p className="ml-4 text-blue-700 text-lg">جاري التحميل...</p>
  </div>
);

// DashboardLayout component: Provides the overall structure of the dashboard, including sidebar and header.
const DashboardLayout = ({ children, activeSection, setActiveSection, userId, userRole, setUserRole }) => {
  // Define sidebar items with their icons, text, and roles that can access them
  const sidebarItems = [
    { icon: "📊", text: "الرئيسية", section: "dashboard", roles: ['admin'] },
    { icon: "🧑‍🎓", text: "الطلاب", section: "students", roles: ['admin'] },
    { icon: "🏫", text: "الفصول", section: "classes", roles: ['admin'] },
    { icon: "📚", text: "الدورات", section: "courses", roles: ['admin'] },
    { icon: "💵", text: "المدفوعات", section: "payments", roles: ['admin'] },
    { icon: "💸", text: "المصاريف", section: "expenses", roles: ['admin'] },
    { icon: "📈", text: "التقارير", section: "reports", roles: ['admin'] },
    { icon: "👨‍🏫", text: "المدربون", section: "instructors", roles: ['admin'] },
    { icon: "🗓️", text: "الحضور", section: "attendance", roles: ['admin', 'supervisor'] },
    { icon: "📜", text: "الشهادات", section: "certificates", roles: ['admin'] },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50 font-sans text-gray-800">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-md rounded-lg m-4 p-4 flex flex-col justify-between">
        <div>
          <div className="text-2xl font-bold text-blue-600 mb-8 px-4 py-2 rounded-lg bg-blue-50">
            لوحة التحكم
          </div>
          <nav className="space-y-2">
            {/* Render sidebar items based on the current user's role */}
            {sidebarItems.map(item => (
              (item.roles.includes(userRole)) && (
                <SidebarItem
                  key={item.section}
                  icon={item.icon}
                  text={item.text}
                  isActive={activeSection === item.section}
                  onClick={() => setActiveSection(item.section)}
                />
              )
            ))}
          </nav>
        </div>
        {userId && (
          <div className="mt-8 p-4 bg-gray-100 rounded-lg text-sm text-gray-600">
            <p className="font-semibold">معرف المستخدم:</p>
            <p className="break-all">{userId}</p>
            <div className="mt-2">
              <label htmlFor="role-switcher" className="block text-xs font-medium text-gray-500 mb-1">
                تبديل الدور (للمحاكاة):
              </label>
              <select
                id="role-switcher"
                value={userRole}
                onChange={(e) => {
                  setUserRole(e.target.value);
                  if (e.target.value === 'supervisor') {
                    setActiveSection('attendance');
                  } else {
                    setActiveSection('dashboard');
                  }
                }}
                className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm rounded-md"
              >
                <option value="admin">المدير</option>
                <option value="supervisor">المشرف</option>
              </select>
            </div>
          </div>
        )}
      </aside>

      {/* Main content area */}
      <main className="flex-1 p-4">
        {/* Header */}
        <header className="bg-white shadow-md rounded-lg p-6 mb-6 flex justify-between items-center">
          <h1 className="text-3xl font-semibold text-gray-700">لوحة تحكم المركز التعليمي</h1>
          <div className="flex items-center space-x-4">
            <span className="text-gray-600">مرحباً، {userRole === 'admin' ? 'المدير' : 'المشرف'}!</span>
          </div>
        </header>

        {/* Dynamic content based on activeSection */}
        <div className="bg-white shadow-md rounded-lg p-6 min-h-[calc(100vh-180px)]">
          {children}
        </div>
      </main>
    </div>
  );
};

// SidebarItem component: Represents a single clickable item in the sidebar.
const SidebarItem = ({ icon, text, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center w-full p-3 rounded-lg text-lg transition-colors duration-200 ${
      isActive
        ? 'bg-blue-100 text-blue-700 font-semibold shadow-sm'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
    } rounded-md`}
  >
    <span className="ml-3 text-2xl">{icon}</span>
    <span>{text}</span>
  </button>
);

// DashboardWidget component: A reusable card for displaying key metrics on the dashboard.
const DashboardWidget = ({ title, value, icon, color, children }) => (
  <div className={`p-6 rounded-lg shadow-md flex flex-col items-start ${color} rounded-md`}>
    <div className="flex items-center justify-between w-full mb-3">
      <span className="text-4xl">{icon}</span>
      <h3 className="text-xl font-semibold text-gray-700">{title}</h3>
    </div>
    <p className="text-5xl font-bold text-gray-900 mt-2">{value}</p>
    {children}
  </div>
);

// ==================================================================================================
// --- MODALS ---
// ==================================================================================================

// AddStudentModal component: Modal for adding new student records.
const AddStudentModal = ({ onClose, onAddStudent, classes }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [studentType, setStudentType] = useState('local');
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'الاسم مطلوب.';
    if (!phone.trim()) newErrors.phone = 'رقم الهاتف مطلوب.';
    else if (!/^\d{10,}$/.test(phone)) newErrors.phone = 'رقم هاتف غير صالح (10 أرقام على الأقل).';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = 'بريد إلكتروني غير صالح.';
    if (!selectedClassId) newErrors.class = 'يجب اختيار فصل.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onAddStudent({
      name,
      phone,
      email,
      paid: false,
      classId: selectedClassId,
      studentType,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">إضافة طالب جديد</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-1">
              اسم الطالب الكامل:
            </label>
            <input
              type="text"
              id="studentName"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل اسم الطالب"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="studentPhone" className="block text-sm font-medium text-gray-700 mb-1">
              رقم الهاتف:
            </label>
            <input
              type="tel"
              id="studentPhone"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setErrors(prev => ({ ...prev, phone: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.phone ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 0911234567"
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label htmlFor="studentEmail" className="block text-sm font-medium text-gray-700 mb-1">
              البريد الإلكتروني (اختياري):
            </label>
            <input
              type="email"
              id="studentEmail"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.email ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل البريد الإلكتروني"
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
          </div>

          <div>
            <label htmlFor="studentClass" className="block text-sm font-medium text-gray-700 mb-1">
              تنسيب إلى فصل:
            </label>
            <select
              id="studentClass"
              value={selectedClassId}
              onChange={(e) => { setSelectedClassId(e.target.value); setErrors(prev => ({ ...prev, class: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.class ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            >
              <option value="">اختر فصلاً...</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            {errors.class && <p className="text-red-500 text-xs mt-1">{errors.class}</p>}
            {classes.length === 0 && (
              <p className="text-red-500 text-xs mt-1">لا توجد فصول متاحة. الرجاء إضافة فصل أولاً.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              نوع الطالب:
            </label>
            <div className="mt-1 flex space-x-4">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="studentType"
                  value="local"
                  checked={studentType === 'local'}
                  onChange={(e) => setStudentType(e.target.value)}
                  className="form-radio text-blue-600 h-4 w-4 rounded-md"
                />
                <span className="ml-2 text-gray-700">محلي</span>
              </label>
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="studentType"
                  value="international"
                  checked={studentType === 'international'}
                  onChange={(e) => setStudentType(e.target.value)}
                  className="form-radio text-blue-600 h-4 w-4 rounded-md"
                />
                <span className="ml-2 text-gray-700">دولي</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إضافة الطالب
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// EditStudentModal component: Modal for editing existing student records.
const EditStudentModal = ({ student, onClose, onUpdateStudent, classes }) => {
  const [name, setName] = useState(student.name);
  const [phone, setPhone] = useState(student.phone);
  const [email, setEmail] = useState(student.email);
  const [paid, setPaid] = useState(student.paid);
  const [selectedClassId, setSelectedClassId] = useState(student.classId || '');
  const [studentType, setStudentType] = useState(student.studentType || 'local');
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'الاسم مطلوب.';
    if (!phone.trim()) newErrors.phone = 'رقم الهاتف مطلوب.';
    else if (!/^\d{10,}$/.test(phone)) newErrors.phone = 'رقم هاتف غير صالح (10 أرقام على الأقل).';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = 'بريد إلكتروني غير صالح.';
    if (!selectedClassId) newErrors.class = 'يجب اختيار فصل.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onUpdateStudent(student.id, {
      name,
      phone,
      email,
      paid,
      classId: selectedClassId,
      studentType,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تعديل بيانات الطالب</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="editStudentName" className="block text-sm font-medium text-gray-700 mb-1">
              اسم الطالب الكامل:
            </label>
            <input
              type="text"
              id="editStudentName"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل اسم الطالب"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="editStudentPhone" className="block text-sm font-medium text-gray-700 mb-1">
              رقم الهاتف:
            </label>
            <input
              type="tel"
              id="editStudentPhone"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setErrors(prev => ({ ...prev, phone: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.phone ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 0911234567"
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label htmlFor="editStudentEmail" className="block text-sm font-medium text-gray-700 mb-1">
              البريد الإلكتروني (اختياري):
            </label>
            <input
              type="email"
              id="editStudentEmail"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.email ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل البريد الإلكتروني"
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="editStudentPaid"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded rounded-md"
            />
            <label htmlFor="editStudentPaid" className="ml-2 block text-sm font-medium text-gray-700">
              تم الدفع
            </label>
          </div>

          <div>
            <label htmlFor="editStudentClass" className="block text-sm font-medium text-gray-700 mb-1">
              تنسيب إلى فصل:
            </label>
            <select
              id="editStudentClass"
              value={selectedClassId}
              onChange={(e) => { setSelectedClassId(e.target.value); setErrors(prev => ({ ...prev, class: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.class ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            >
              <option value="">اختر فصلاً...</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            {errors.class && <p className="text-red-500 text-xs mt-1">{errors.class}</p>}
            {classes.length === 0 && (
              <p className="text-red-500 text-xs mt-1">لا توجد فصول متاحة. الرجاء إضافة فصل أولاً.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              نوع الطالب:
            </label>
            <div className="mt-1 flex space-x-4">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="editStudentType"
                  value="local"
                  checked={studentType === 'local'}
                  onChange={(e) => setStudentType(e.target.value)}
                  className="form-radio text-blue-600 h-4 w-4 rounded-md"
                />
                <span className="ml-2 text-gray-700">محلي</span>
              </label>
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="editStudentType"
                  value="international"
                  checked={studentType === 'international'}
                  onChange={(e) => setStudentType(e.target.value)}
                  className="form-radio text-blue-600 h-4 w-4 rounded-md"
                />
                <span className="ml-2 text-gray-700">دولي</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// AddClassModal component: Modal for creating new classes.
const AddClassModal = ({ onClose, onAddClass }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'اسم الفصل مطلوب.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onAddClass({ name, description });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">إنشاء فصل جديد</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="className" className="block text-sm font-medium text-gray-700 mb-1">
              اسم الفصل:
            </label>
            <input
              type="text"
              id="className"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: فصل الرياضيات 101"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="classDescription" className="block text-sm font-medium text-gray-700 mb-1">
              الوصف (اختياري):
            </label>
            <textarea
              id="classDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="3"
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="أدخل وصفًا موجزًا للفصل"
            ></textarea>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إنشاء الفصل
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// EditClassModal component: Modal for editing existing class details.
const EditClassModal = ({ cls, onClose, onUpdateClass }) => {
  const [name, setName] = useState(cls.name);
  const [description, setDescription] = useState(cls.description);
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'اسم الفصل مطلوب.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onUpdateClass(cls.id, { name, description });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تعديل الفصل</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="editClassName" className="block text-sm font-medium text-gray-700 mb-1">
              اسم الفصل:
            </label>
            <input
              type="text"
              id="editClassName"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: فصل الرياضيات 101"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="editClassDescription" className="block text-sm font-medium text-gray-700 mb-1">
              الوصف (اختياري):
            </label>
            <textarea
              id="editClassDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="3"
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="أدخل وصفًا موجزًا للفصل"
            ></textarea>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// AssignStudentsToClassModal component: Modal for assigning students to a class.
const AssignStudentsToClassModal = ({ cls, students, onClose, onUpdateClass }) => {
  const [selectedStudentIds, setSelectedStudentIds] = useState(cls.students || []);

  const handleCheckboxChange = (studentId) => {
    setSelectedStudentIds(prevSelected =>
      prevSelected.includes(studentId)
        ? prevSelected.filter(id => id !== studentId)
        : [...prevSelected, studentId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onUpdateClass(cls.id, { students: selectedStudentIds });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تنسيب طلاب إلى فصل: {cls.name}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-md p-3 rounded-md">
            {students.length === 0 ? (
              <p className="text-sm text-gray-500">لا يوجد طلاب متاحون للتنسيب.</p>
            ) : (
              students.map(student => (
                <div key={student.id} className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id={`student-${student.id}`}
                    checked={selectedStudentIds.includes(student.id)}
                    onChange={() => handleCheckboxChange(student.id)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded rounded-md"
                  />
                  <label htmlFor={`student-${student.id}`} className="ml-2 block text-sm font-medium text-gray-700">
                    {student.name} ({student.email || student.phone})
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// AssignInstructorsToClassModal component: Modal for assigning instructors to a class.
const AssignInstructorsToClassModal = ({ cls, instructors, onClose, onUpdateClass }) => {
  const [selectedInstructorIds, setSelectedInstructorIds] = useState(cls.instructors || []);

  const handleCheckboxChange = (instructorId) => {
    setSelectedInstructorIds(prevSelected =>
      prevSelected.includes(instructorId)
        ? prevSelected.filter(id => id !== instructorId)
        : [...prevSelected, instructorId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onUpdateClass(cls.id, { instructors: selectedInstructorIds });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تنسيب مدربين إلى فصل: {cls.name}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-md p-3 rounded-md">
            {instructors.length === 0 ? (
              <p className="text-sm text-gray-500">لا يوجد مدربون متاحون للتنسيب.</p>
            ) : (
              instructors.map(instructor => (
                <div key={instructor.id} className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id={`instructor-${instructor.id}`}
                    checked={selectedInstructorIds.includes(instructor.id)}
                    onChange={() => handleCheckboxChange(instructor.id)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded rounded-md"
                  />
                  <label htmlFor={`instructor-${instructor.id}`} className="ml-2 block text-sm font-medium text-gray-700">
                    {instructor.name} ({instructor.specialty || 'لا يوجد تخصص'})
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// AddPaymentModal component: Modal for adding new payment records.
const AddPaymentModal = ({ onClose, onAddPayment, students, courses }) => {
  const [studentId, setStudentId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [discount, setDiscount] = useState('');
  const [status, setStatus] = useState('مدفوع');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!studentId) newErrors.student = 'يجب اختيار طالب.';
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) newErrors.amount = 'المبلغ مطلوب ويجب أن يكون رقماً موجباً.';
    if (!date) newErrors.date = 'التاريخ مطلوب.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onAddPayment({
      studentId,
      courseId: courseId || null,
      amount: parseFloat(amount),
      date: new Date(date),
      discount: parseFloat(discount) || 0,
      status,
      notes,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">إضافة دفعة جديدة</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="studentSelect" className="block text-sm font-medium text-gray-700 mb-1">
              الطالب:
            </label>
            <select
              id="studentSelect"
              value={studentId}
              onChange={(e) => { setStudentId(e.target.value); setErrors(prev => ({ ...prev, student: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.student ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            >
              <option value="">اختر طالباً...</option>
              {students.map(student => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
            {errors.student && <p className="text-red-500 text-xs mt-1">{errors.student}</p>}
          </div>
          <div>
            <label htmlFor="courseSelect" className="block text-sm font-medium text-gray-700 mb-1">
              الدورة (اختياري):
            </label>
            <select
              id="courseSelect"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="">اختر دورة...</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>
                  {course.name} ({course.price.toLocaleString()} د.ل)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="paymentAmount" className="block text-sm font-medium text-gray-700 mb-1">
              المبلغ (د.ل):
            </label>
            <input
              type="number"
              id="paymentAmount"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErrors(prev => ({ ...prev, amount: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.amount ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 250.00"
              step="0.01"
            />
            {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
          </div>
          <div>
            <label htmlFor="paymentDate" className="block text-sm font-medium text-gray-700 mb-1">
              التاريخ:
            </label>
            <input
              type="date"
              id="paymentDate"
              value={date}
              onChange={(e) => { setDate(e.target.value); setErrors(prev => ({ ...prev, date: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.date ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            />
            {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date}</p>}
          </div>
          <div>
            <label htmlFor="paymentDiscount" className="block text-sm font-medium text-gray-700 mb-1">
              الخصم (د.ل) (اختياري):
            </label>
            <input
              type="number"
              id="paymentDiscount"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="مثال: 20.00"
              step="0.01"
            />
          </div>
          <div>
            <label htmlFor="paymentStatus" className="block text-sm font-medium text-gray-700 mb-1">
              الحالة:
            </label>
            <select
              id="paymentStatus"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="مدفوع">مدفوع</option>
              <option value="معلق">معلق</option>
              <option value="جزئي">جزئي</option>
            </select>
          </div>
          <div>
            <label htmlFor="paymentNotes" className="block text-sm font-medium text-gray-700 mb-1">
              ملاحظات (اختياري):
            </label>
            <textarea
              id="paymentNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows="2"
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="أدخل أي ملاحظات حول الدفعة"
            ></textarea>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إضافة الدفعة
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// EditPaymentModal component: Modal for editing existing payment records.
const EditPaymentModal = ({ payment, onClose, onUpdatePayment, students, courses }) => {
  const [studentId, setStudentId] = useState(payment.studentId);
  const [courseId, setCourseId] = useState(payment.courseId || '');
  const [amount, setAmount] = useState(payment.amount);
  const [date, setDate] = useState(payment.date.toDate().toISOString().split('T')[0]);
  const [discount, setDiscount] = useState(payment.discount || '');
  const [status, setStatus] = useState(payment.status);
  const [notes, setNotes] = useState(payment.notes || '');
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!studentId) newErrors.student = 'يجب اختيار طالب.';
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) newErrors.amount = 'المبلغ مطلوب ويجب أن يكون رقماً موجباً.';
    if (!date) newErrors.date = 'التاريخ مطلوب.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onUpdatePayment(payment.id, {
      studentId,
      courseId: courseId || null,
      amount: parseFloat(amount),
      date: new Date(date),
      discount: parseFloat(discount) || 0,
      status,
      notes,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تعديل الدفعة</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="editStudentSelect" className="block text-sm font-medium text-gray-700 mb-1">
              الطالب:
            </label>
            <select
              id="editStudentSelect"
              value={studentId}
              onChange={(e) => { setStudentId(e.target.value); setErrors(prev => ({ ...prev, student: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.student ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            >
              <option value="">اختر طالباً...</option>
              {students.map(student => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
            {errors.student && <p className="text-red-500 text-xs mt-1">{errors.student}</p>}
          </div>
          <div>
            <label htmlFor="editCourseSelect" className="block text-sm font-medium text-gray-700 mb-1">
              الدورة (اختياري):
            </label>
            <select
              id="editCourseSelect"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="">اختر دورة...</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>
                  {course.name} ({course.price.toLocaleString()} د.ل)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="editPaymentAmount" className="block text-sm font-medium text-gray-700 mb-1">
              المبلغ (د.ل):
            </label>
            <input
              type="number"
              id="editPaymentAmount"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErrors(prev => ({ ...prev, amount: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.amount ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 250.00"
              step="0.01"
            />
            {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
          </div>
          <div>
            <label htmlFor="editPaymentDate" className="block text-sm font-medium text-gray-700 mb-1">
              التاريخ:
            </label>
            <input
              type="date"
              id="editPaymentDate"
              value={date}
              onChange={(e) => { setDate(e.target.value); setErrors(prev => ({ ...prev, date: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.date ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            />
            {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date}</p>}
          </div>
          <div>
            <label htmlFor="editPaymentDiscount" className="block text-sm font-medium text-gray-700 mb-1">
              الخصم (د.ل) (اختياري):
            </label>
            <input
              type="number"
              id="editPaymentDiscount"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="مثال: 20.00"
              step="0.01"
            />
          </div>
          <div>
            <label htmlFor="editPaymentStatus" className="block text-sm font-medium text-gray-700 mb-1">
              الحالة:
            </label>
            <select
              id="editPaymentStatus"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="مدفوع">مدفوع</option>
              <option value="معلق">معلق</option>
              <option value="جزئي">جزئي</option>
            </select>
          </div>
          <div>
            <label htmlFor="editPaymentNotes" className="block text-sm font-medium text-gray-700 mb-1">
              ملاحظات (اختياري):
            </label>
            <textarea
              id="editPaymentNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows="2"
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="أدخل أي ملاحظات حول الدفعة"
            ></textarea>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// AddCourseModal component: Modal for adding new course records.
const AddCourseModal = ({ onClose, onAddCourse }) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'اسم الدورة مطلوب.';
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) newErrors.price = 'السعر مطلوب ويجب أن يكون رقماً موجباً.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onAddCourse({ name, price: parseFloat(price), description });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">إضافة دورة جديدة</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="courseName" className="block text-sm font-medium text-gray-700 mb-1">
              اسم الدورة:
            </label>
            <input
              type="text"
              id="courseName"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل اسم الدورة"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="coursePrice" className="block text-sm font-medium text-gray-700 mb-1">
              السعر (د.ل):
            </label>
            <input
              type="number"
              id="coursePrice"
              value={price}
              onChange={(e) => { setPrice(e.target.value); setErrors(prev => ({ ...prev, price: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.price ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 500.00"
              step="0.01"
            />
            {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price}</p>}
          </div>
          <div>
            <label htmlFor="courseDescription" className="block text-sm font-medium text-gray-700 mb-1">
              الوصف (اختياري):
            </label>
            <textarea
              id="courseDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="3"
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="أدخل وصفًا موجزًا للدورة"
            ></textarea>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إضافة الدورة
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// EditCourseModal component: Modal for editing existing course details.
const EditCourseModal = ({ course, onClose, onUpdateCourse }) => {
  const [name, setName] = useState(course.name);
  const [price, setPrice] = useState(course.price);
  const [description, setDescription] = useState(course.description);
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'اسم الدورة مطلوب.';
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) newErrors.price = 'السعر مطلوب ويجب أن يكون رقماً موجباً.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onUpdateCourse(course.id, { name, price: parseFloat(price), description });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تعديل الدورة</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="editCourseName" className="block text-sm font-medium text-gray-700 mb-1">
              اسم الدورة:
            </label>
            <input
              type="text"
              id="editCourseName"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل اسم الدورة"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="editCoursePrice" className="block text-sm font-medium text-gray-700 mb-1">
              السعر (د.ل):
            </label>
            <input
              type="number"
              id="editCoursePrice"
              value={price}
              onChange={(e) => { setPrice(e.target.value); setErrors(prev => ({ ...prev, price: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.price ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 500.00"
              step="0.01"
            />
            {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price}</p>}
          </div>
          <div>
            <label htmlFor="editCourseDescription" className="block text-sm font-medium text-gray-700 mb-1">
              الوصف (اختياري):
            </label>
            <textarea
              id="editCourseDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="3"
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="أدخل وصفًا موجزًا للدورة"
            ></textarea>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// AddExpenseModal component: Modal for adding new expense records.
const AddExpenseModal = ({ onClose, onAddExpense }) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!description.trim()) newErrors.description = 'الوصف مطلوب.';
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) newErrors.amount = 'المبلغ مطلوب ويجب أن يكون رقماً موجباً.';
    if (!date) newErrors.date = 'التاريخ مطلوب.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onAddExpense({
      description,
      amount: parseFloat(amount),
      category: category || 'عام',
      date: new Date(date),
    });
    onClose();
  };

  const categories = ['رواتب', 'إيجار', 'كهرباء/ماء', 'صيانة', 'لوازم', 'تسويق', 'عام'];

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">إضافة مصروف جديد</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="expenseDescription" className="block text-sm font-medium text-gray-700 mb-1">
              الوصف:
            </label>
            <input
              type="text"
              id="expenseDescription"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors(prev => ({ ...prev, description: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.description ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: إيجار مبنى المركز"
            />
            {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
          </div>
          <div>
            <label htmlFor="expenseAmount" className="block text-sm font-medium text-gray-700 mb-1">
              المبلغ (د.ل):
            </label>
            <input
              type="number"
              id="expenseAmount"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErrors(prev => ({ ...prev, amount: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.amount ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 1500.00"
              step="0.01"
            />
            {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
          </div>
          <div>
            <label htmlFor="expenseCategory" className="block text-sm font-medium text-gray-700 mb-1">
              الفئة:
            </label>
            <select
              id="expenseCategory"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="">اختر فئة</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="expenseDate" className="block text-sm font-medium text-gray-700 mb-1">
              التاريخ:
            </label>
            <input
              type="date"
              id="expenseDate"
              value={date}
              onChange={(e) => { setDate(e.target.value); setErrors(prev => ({ ...prev, date: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.date ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            />
            {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date}</p>}
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إضافة المصروف
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// EditExpenseModal component: Modal for editing existing expense records.
const EditExpenseModal = ({ expense, onClose, onUpdateExpense }) => {
  const [description, setDescription] = useState(expense.description);
  const [amount, setAmount] = useState(expense.amount);
  const [category, setCategory] = useState(expense.category);
  const [date, setDate] = useState(expense.date.toDate().toISOString().split('T')[0]);
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!description.trim()) newErrors.description = 'الوصف مطلوب.';
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) newErrors.amount = 'المبلغ مطلوب ويجب أن يكون رقماً موجباً.';
    if (!date) newErrors.date = 'التاريخ مطلوب.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onUpdateExpense(expense.id, {
      description,
      amount: parseFloat(amount),
      category,
      date: new Date(date),
    });
    onClose();
  };

  const categories = ['رواتب', 'إيجار', 'كهرباء/ماء', 'صيانة', 'لوازم', 'تسويق', 'عام'];

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تعديل المصروف</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="editExpenseDescription" className="block text-sm font-medium text-gray-700 mb-1">
              الوصف:
            </label>
            <input
              type="text"
              id="editExpenseDescription"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors(prev => ({ ...prev, description: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.description ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: إيجار مبنى المركز"
            />
            {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
          </div>
          <div>
            <label htmlFor="editExpenseAmount" className="block text-sm font-medium text-gray-700 mb-1">
              المبلغ (د.ل):
            </label>
            <input
              type="number"
              id="editExpenseAmount"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErrors(prev => ({ ...prev, amount: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.amount ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 1500.00"
              step="0.01"
            />
            {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
          </div>
          <div>
            <label htmlFor="editExpenseCategory" className="block text-sm font-medium text-gray-700 mb-1">
              الفئة:
            </label>
            <select
              id="editExpenseCategory"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="">اختر فئة</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="editExpenseDate" className="block text-sm font-medium text-gray-700 mb-1">
              التاريخ:
            </label>
            <input
              type="date"
              id="editExpenseDate"
              value={date}
              onChange={(e) => { setDate(e.target.value); setErrors(prev => ({ ...prev, date: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.date ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
            />
            {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date}</p>}
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// AddInstructorModal component: Modal for adding new instructor records.
const AddInstructorModal = ({ onClose, onAddInstructor, courses }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [courseRates, setCourseRates] = useState({});
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'الاسم مطلوب.';
    if (!phone.trim()) newErrors.phone = 'رقم الهاتف مطلوب.';
    else if (!/^\d{10,}$/.test(phone)) newErrors.phone = 'رقم هاتف غير صالح (10 أرقام على الأقل).';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = 'بريد إلكتروني غير صالح.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRateChange = (courseId, rate) => {
    setCourseRates(prev => ({
      ...prev,
      [courseId]: parseFloat(rate) || 0
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onAddInstructor({ name, phone, email, specialty, courseRates });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">إضافة مدرب جديد</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="instructorName" className="block text-sm font-medium text-gray-700 mb-1">
              اسم المدرب الكامل:
            </label>
            <input
              type="text"
              id="instructorName"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل اسم المدرب"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="instructorPhone" className="block text-sm font-medium text-gray-700 mb-1">
              رقم الهاتف:
            </label>
            <input
              type="tel"
              id="instructorPhone"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setErrors(prev => ({ ...prev, phone: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.phone ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 0911234567"
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label htmlFor="instructorEmail" className="block text-sm font-medium text-gray-700 mb-1">
              البريد الإلكتروني (اختياري):
            </label>
            <input
              type="email"
              id="instructorEmail"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.email ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل البريد الإلكتروني"
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
          </div>
          <div>
            <label htmlFor="instructorSpecialty" className="block text-sm font-medium text-gray-700 mb-1">
              التخصص (اختياري):
            </label>
            <input
              type="text"
              id="instructorSpecialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              placeholder="مثال: لغة إنجليزية"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              أجور الدورات (لكل طالب في الدورة) (اختياري):
            </label>
            {courses.length === 0 ? (
              <p className="text-sm text-gray-500">لا توجد دورات لإعداد أجور لها.</p>
            ) : (
              courses.map(course => (
                <div key={course.id} className="flex items-center mb-2">
                  <label htmlFor={`rate-${course.id}`} className="block text-sm font-medium text-gray-700 w-1/2">
                    {course.name}:
                  </label>
                  <input
                    type="number"
                    id={`rate-${course.id}`}
                    value={courseRates[course.id] || ''}
                    onChange={(e) => handleRateChange(course.id, e.target.value)}
                    className="mt-1 block w-1/2 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    placeholder="أجر الطالب"
                    step="0.01"
                  />
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إضافة المدرب
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// EditInstructorModal component: Modal for editing existing instructor records.
const EditInstructorModal = ({ instructor, onClose, onUpdateInstructor, courses }) => {
  const [name, setName] = useState(instructor.name);
  const [phone, setPhone] = useState(instructor.phone);
  const [email, setEmail] = useState(instructor.email);
  const [specialty, setSpecialty] = useState(instructor.specialty);
  const [courseRates, setCourseRates] = useState(instructor.courseRates || {});
  const [errors, setErrors] = useState({});
  const { addToast } = useNotification();

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'الاسم مطلوب.';
    if (!phone.trim()) newErrors.phone = 'رقم الهاتف مطلوب.';
    else if (!/^\d{10,}$/.test(phone)) newErrors.phone = 'رقم هاتف غير صالح (10 أرقام على الأقل).';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = 'بريد إلكتروني غير صالح.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRateChange = (courseId, rate) => {
    setCourseRates(prev => ({
      ...prev,
      [courseId]: parseFloat(rate) || 0
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast("الرجاء تصحيح الأخطاء في النموذج.", "error");
      return;
    }
    await onUpdateInstructor(instructor.id, { name, phone, email, specialty, courseRates });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md rounded-md">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">تعديل بيانات المدرب</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="editInstructorName" className="block text-sm font-medium text-gray-700 mb-1">
              اسم المدرب الكامل:
            </label>
            <input
              type="text"
              id="editInstructorName"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.name ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل اسم المدرب"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="editInstructorPhone" className="block text-sm font-medium text-gray-700 mb-1">
              رقم الهاتف:
            </label>
            <input
              type="tel"
              id="editInstructorPhone"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setErrors(prev => ({ ...prev, phone: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.phone ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="مثال: 0911234567"
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label htmlFor="editInstructorEmail" className="block text-sm font-medium text-gray-700 mb-1">
              البريد الإلكتروني (اختياري):
            </label>
            <input
              type="email"
              id="editInstructorEmail"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: '' })); }}
              className={`mt-1 block w-full px-4 py-2 border ${errors.email ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md`}
              placeholder="أدخل البريد الإلكتروني"
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              أجور الدورات (لكل طالب في الدورة) (اختياري):
            </label>
            {courses.length === 0 ? (
              <p className="text-sm text-gray-500">لا توجد دورات لإعداد أجور لها.</p>
            ) : (
              courses.map(course => (
                <div key={course.id} className="flex items-center mb-2">
                  <label htmlFor={`edit-rate-${course.id}`} className="block text-sm font-medium text-gray-700 w-1/2">
                    {course.name}:
                  </label>
                  <input
                    type="number"
                    id={`edit-rate-${course.id}`}
                    value={courseRates[course.id] || ''}
                    onChange={(e) => handleRateChange(course.id, e.target.value)}
                    className="mt-1 block w-1/2 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    placeholder="أجر الطالب"
                    step="0.01"
                  />
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-md"
            >
              حفظ التغييرات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// PaymentsPage component: Manages payment records.
const PaymentsPage = ({ payments, addPayment, updatePayment, deletePayment, students, courses, showConfirmModal }) => {
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false);
  const [currentPayment, setCurrentPayment] = useState(null);

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getStudentName = (studentId) => {
    const student = students.find(s => s.id === studentId);
    return student ? student.name : 'طالب غير معروف';
  };

  const getCourseName = (courseId) => {
    const course = courses.find(c => c.id === courseId);
    return course ? course.name : 'لا توجد دورة محددة';
  };

  const handleEditClick = (payment) => {
    setCurrentPayment(payment);
    setShowEditPaymentModal(true);
  };

  const handleDeleteClick = (paymentId) => {
    showConfirmModal("هل أنت متأكد أنك تريد حذف هذه الدفعة؟", () => deletePayment(paymentId));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-700">إدارة المدفوعات</h2>
        <button
          onClick={() => setShowAddPaymentModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
        >
          + إضافة دفعة جديدة
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden rounded-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الطالب
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الدورة
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                المبلغ
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الخصم
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                التاريخ
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الحالة
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                ملاحظات
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الإجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {payments.length === 0 ? (
              <tr>
                <td colSpan="9" className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                  لا يوجد دفعات مسجلة بعد.
                </td>
              </tr>
            ) : (
              payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {getStudentName(payment.studentId)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {getCourseName(payment.courseId)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {payment.amount.toLocaleString()} د.ل
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {payment.discount.toLocaleString()} د.ل
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(payment.date)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        payment.status === 'مدفوع' ? 'bg-green-100 text-green-800' :
                        payment.status === 'معلق' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      } rounded-full`}
                    >
                      {payment.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {payment.notes || 'لا يوجد'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEditClick(payment)}
                      className="text-blue-600 hover:text-blue-900 ml-4"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleDeleteClick(payment.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddPaymentModal && (
        <AddPaymentModal onClose={() => setShowAddPaymentModal(false)} onAddPayment={addPayment} students={students} courses={courses} />
      )}

      {showEditPaymentModal && currentPayment && (
        <EditPaymentModal
          payment={currentPayment}
          onClose={() => setShowEditPaymentModal(false)}
          onUpdatePayment={updatePayment}
          students={students}
          courses={courses}
        />
      )}
    </div>
  );
};

// ReportsPage component: Displays various reports and charts.
const ReportsPage = ({ students, classes, expenses, courses, payments, addToast }) => {
  const [selectedClassIds, setSelectedClassIds] = useState([]);

  const totalRevenue = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const netIncome = totalRevenue - totalExpenses;

  const paidStudentsCount = students.filter(s => s.paid).length;
  const unpaidStudentsCount = students.length - paidStudentsCount;
  const studentStatusData = [
    { name: 'طلاب مدفوعة', value: paidStudentsCount, color: '#4CAF50' },
    { name: 'طلاب غير مدفوعة', value: unpaidStudentsCount, color: '#F44336' },
  ];

  const classEnrollmentData = classes.map(cls => ({
    name: cls.name,
    students: cls.students ? cls.students.length : 0
  }));

  const expensesByCategory = expenses.reduce((acc, expense) => {
    const category = expense.category || 'غير مصنف';
    acc[category] = (acc[category] || 0) + expense.amount;
    return acc;
  }, {});
  const expensesByCategoryData = Object.entries(expensesByCategory).map(([name, value]) => ({ name, value }));

  const revenueByCourse = payments.reduce((acc, payment) => {
    if (payment.courseId) {
      const course = courses.find(c => c.id === payment.courseId);
      if (course) {
        acc[course.name] = (acc[course.name] || 0) + payment.amount;
      }
    }
    return acc;
  }, {});
  const revenueByCourseData = Object.entries(revenueByCourse).map(([name, value]) => ({ name, value }));

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'];

  const handleClassSelectionChange = (e) => {
    const { value, checked } = e.target;
    setSelectedClassIds(prev =>
      checked ? [...prev, value] : prev.filter(id => id !== value)
    );
  };

  const handleExportStudentsByClass = () => {
    if (selectedClassIds.length === 0) {
      addToast("الرجاء اختيار فصل واحد على الأقل لتصدير بيانات الطلاب.", "info");
      return;
    }

    const exportedStudents = new Set();
    const dataToExport = [];

    selectedClassIds.forEach(classId => {
      const selectedClass = classes.find(cls => cls.id === classId);
      if (selectedClass && selectedClass.students) {
        selectedClass.students.forEach(studentId => {
          if (!exportedStudents.has(studentId)) {
            const student = students.find(s => s.id === studentId);
            if (student) {
              dataToExport.push({
                'اسم الطالب': student.name,
                'رقم الهاتف': student.phone,
                'البريد الإلكتروني': student.email || '',
                'حالة الدفع': student.paid ? 'مدفوع' : 'غير مدفوع',
                'الفصل': selectedClass.name
              });
              exportedStudents.add(studentId);
            }
          }
        });
      }
    });

    if (dataToExport.length > 0) {
      exportToCsv('student_data_by_class.csv', dataToExport, addToast);
    } else {
      addToast("لا يوجد طلاب في الفصول المختارة لتصدير بياناتهم.", "info");
    }
  };


  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-semibold text-gray-700 mb-6">التقارير الشاملة</h2>

      <div className="bg-white p-6 rounded-lg shadow-md rounded-md">
        <h3 className="text-2xl font-semibold text-gray-800 mb-4">نظرة عامة مالية</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div className="p-4 bg-blue-50 rounded-lg rounded-md">
            <p className="text-lg text-gray-600">إجمالي الإيرادات</p>
            <p className="text-3xl font-bold text-blue-800">{totalRevenue.toLocaleString()} د.ل</p>
          </div>
          <div className="p-4 bg-red-50 rounded-lg rounded-md">
            <p className="text-lg text-gray-600">إجمالي المصاريف</p>
            <p className="text-3xl font-bold text-red-800">{totalExpenses.toLocaleString()} د.ل</p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg rounded-md">
            <p className="text-lg text-gray-600">صافي الدخل</p>
            <p className={`text-3xl font-bold ${netIncome >= 0 ? 'text-green-800' : 'text-red-800'}`}>
              {netIncome.toLocaleString()} د.ل
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md rounded-md">
        <h3 className="text-2xl font-semibold text-gray-800 mb-4">حالة دفع الطلاب</h3>
        {students.length === 0 ? (
          <p className="text-center text-gray-500">لا توجد بيانات طلاب لعرضها.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={studentStatusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {studentStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md rounded-md">
        <h3 className="text-2xl font-semibold text-gray-800 mb-4">عدد الطلاب في الفصول</h3>
        {classEnrollmentData.length === 0 ? (
          <p className="text-center text-gray-500">لا توجد بيانات فصول لعرضها.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={classEnrollmentData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="students" fill="#8884d8" name="عدد الطلاب" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md rounded-md">
        <h3 className="text-2xl font-semibold text-gray-800 mb-4">تصدير بيانات الطلاب حسب الفصل</h3>
        {classes.length === 0 ? (
          <p className="text-center text-gray-500">لا توجد فصول لإدارة تصدير الطلاب.</p>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                اختر الفصول لتصدير بيانات طلابها:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-300 p-3 rounded-md">
                {classes.map(cls => (
                  <div key={cls.id} className="flex items-center">
                    <input
                      type="checkbox"
                      id={`class-${cls.id}`}
                      value={cls.id}
                      checked={selectedClassIds.includes(cls.id)}
                      onChange={handleClassSelectionChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded rounded-md"
                    />
                    <label htmlFor={`class-${cls.id}`} className="ml-2 text-sm text-gray-700">
                      {cls.name} ({cls.students ? cls.students.length : 0} طلاب)
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={handleExportStudentsByClass}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
            >
              تصدير الطلاب في الفصول المختارة (CSV)
            </button>
          </>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md rounded-md">
        <h3 className="text-2xl font-semibold text-gray-800 mb-4">المصاريف حسب الفئة</h3>
        {expensesByCategoryData.length === 0 ? (
          <p className="text-center text-gray-500">لا توجد بيانات مصاريف لعرضها.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={expensesByCategoryData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {expensesByCategoryData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value.toLocaleString()} د.ل`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md rounded-md">
        <h3 className="text-2xl font-semibold text-gray-800 mb-4">الإيرادات حسب الدورة</h3>
        {revenueByCourseData.length === 0 ? (
          <p className="text-center text-gray-500">لا توجد بيانات إيرادات للدورات لعرضها.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={revenueByCourseData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis formatter={(value) => `${value.toLocaleString()} د.ل`} />
              <Tooltip formatter={(value) => `${value.toLocaleString()} د.ل`} />
              <Legend />
              <Bar dataKey="value" fill="#00C49F" name="الإيرادات" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md text-center text-gray-500 rounded-md">
        <h3 className="text-2xl font-semibold text-gray-700 mb-4">تقارير إضافية قريباً...</h3>
        <p>مثل: تقارير حضور الطلاب، تقارير أداء المدربين، تقارير الدفعات المتأخرة.</p>
        <div className="mt-8">
          <img
            src="https://placehold.co/400x200/E0F2F7/0288D1?text=Reports+Coming+Soon"
            alt="[Image of Reports Coming Soon]"
            className="mx-auto rounded-lg shadow-md rounded-md"
          />
        </div>
      </div>
    </div>
  );
};


// AttendancePage component: Manages student attendance records.
const AttendancePage = ({ students, classes, instructors, addAttendance, attendances, addToast }) => {
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedInstructorId, setSelectedInstructorId] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [classStudents, setClassStudents] = useState([]);
  const [attendanceStatuses, setAttendanceStatuses] = useState({});

  useEffect(() => {
    if (selectedClassId) {
      const currentClass = classes.find(cls => cls.id === selectedClassId);
      if (currentClass && currentClass.students) {
        const studentsInClass = students.filter(s => currentClass.students.includes(s.id));
        setClassStudents(studentsInClass);

        const existingAttendanceMap = {};
        attendances.forEach(att => {
          const attDate = att.date.toDate().toISOString().split('T')[0];
          if (att.classId === selectedClassId && attDate === selectedDate) {
            existingAttendanceMap[att.studentId] = att.status;
          }
        });
        setAttendanceStatuses(existingAttendanceMap);
      } else {
        setClassStudents([]);
        setAttendanceStatuses({});
      }
    } else {
      setClassStudents([]);
      setAttendanceStatuses({});
    }
  }, [selectedClassId, students, classes, selectedDate, attendances]);

  const handleAttendanceChange = (studentId, status) => {
    setAttendanceStatuses(prev => ({
      ...prev,
      [studentId]: status
    }));
  };

  const handleSubmitAttendance = async () => {
    if (!selectedClassId || !selectedInstructorId || !selectedDate) {
      addToast("الرجاء اختيار الفصل، المدرب، والتاريخ أولاً.", "error");
      return;
    }

    if (Object.keys(attendanceStatuses).length === 0) {
      addToast("الرجاء تسجيل حضور الطلاب قبل الحفظ.", "info");
      return;
    }

    const attendanceRecordsToSave = [];
    for (const studentId in attendanceStatuses) {
      attendanceRecordsToSave.push({
        studentId,
        classId: selectedClassId,
        instructorId: selectedInstructorId,
        date: new Date(selectedDate),
        status: attendanceStatuses[studentId],
      });
    }

    try {
      // Use Promise.all to add/update all attendance records concurrently
      await Promise.all(attendanceRecordsToSave.map(record => addAttendance(record)));
      addToast("تم حفظ سجل الحضور بنجاح!", "success");
    } catch (error) {
      console.error("Error saving attendance:", error);
      addToast("حدث خطأ أثناء حفظ سجل الحضور.", "error");
    }
  };

  const getInstructorName = (id) => {
    const instructor = instructors.find(inst => inst.id === id);
    return instructor ? instructor.name : 'غير معروف';
  };

  const getClassInstructors = (classId) => {
    const cls = classes.find(c => c.id === classId);
    if (!cls || !cls.instructors) return [];
    return instructors.filter(inst => cls.instructors.includes(inst.id));
  };


  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-gray-700">إدارة الحضور والغياب</h2>

      <div className="bg-white p-6 rounded-lg shadow-md flex flex-wrap gap-4 items-end rounded-md">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="classSelect" className="block text-sm font-medium text-gray-700 mb-1">
            اختر الفصل:
          </label>
          <select
            id="classSelect"
            value={selectedClassId}
            onChange={(e) => {
              setSelectedClassId(e.target.value);
              setSelectedInstructorId('');
            }}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          >
            <option value="">اختر فصل...</option>
            {classes.map(cls => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[200px]">
          <label htmlFor="instructorSelect" className="block text-sm font-medium text-gray-700 mb-1">
            اختر المدرب:
          </label>
          <select
            id="instructorSelect"
            value={selectedInstructorId}
            onChange={(e) => setSelectedInstructorId(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            disabled={!selectedClassId || getClassInstructors(selectedClassId).length === 0}
          >
            <option value="">اختر مدرباً...</option>
            {selectedClassId && getClassInstructors(selectedClassId).map(inst => (
              <option key={inst.id} value={inst.id}>{inst.name}</option>
            ))}
          </select>
          {selectedClassId && getClassInstructors(selectedClassId).length === 0 && (
            <p className="text-red-500 text-xs mt-1">لا يوجد مدربون منسوبون لهذا الفصل.</p>
          )}
        </div>

        <div className="flex-1 min-w-[200px]">
          <label htmlFor="attendanceDate" className="block text-sm font-medium text-gray-700 mb-1">
            التاريخ:
          </label>
          <input
            type="date"
            id="attendanceDate"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          />
        </div>
      </div>

      {selectedClassId && selectedInstructorId && classStudents.length > 0 &&
        <div className="bg-white rounded-lg shadow-md overflow-hidden mt-6 rounded-md">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  اسم الطالب
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  الحالة
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {classStudents.map(student => (
                <tr key={student.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {student.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center space-x-4">
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          name={`attendance-${student.id}`}
                          value="present"
                          checked={attendanceStatuses[student.id] === 'present'}
                          onChange={() => handleAttendanceChange(student.id, 'present')}
                          className="form-radio text-green-600 h-4 w-4 rounded-md"
                        />
                        <span className="ml-2 text-green-700">حاضر</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          name={`attendance-${student.id}`}
                          value="absent"
                          checked={attendanceStatuses[student.id] === 'absent'}
                          onChange={() => handleAttendanceChange(student.id, 'absent')}
                          className="form-radio text-red-600 h-4 w-4 rounded-md"
                        />
                        <span className="ml-2 text-red-700">غائب</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          name={`attendance-${student.id}`}
                          value="late"
                          checked={attendanceStatuses[student.id] === 'late'}
                          onChange={() => handleAttendanceChange(student.id, 'late')}
                          className="form-radio text-yellow-600 h-4 w-4 rounded-md"
                        />
                        <span className="ml-2 text-yellow-700">متأخر</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          name={`attendance-${student.id}`}
                          value="excused"
                          checked={attendanceStatuses[student.id] === 'excused'}
                          onChange={() => handleAttendanceChange(student.id, 'excused')}
                          className="form-radio text-gray-600 h-4 w-4 rounded-md"
                        />
                        <span className="ml-2 text-gray-700">بعذر</span>
                      </label>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 bg-gray-50 flex justify-end">
            <button
              onClick={handleSubmitAttendance}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
            >
              حفظ الحضور
            </button>
          </div>
        </div>
      }

      {selectedClassId && selectedInstructorId && classStudents.length === 0 &&
        <div className="text-center text-gray-500 p-6 bg-white rounded-lg shadow-md rounded-md">
          <p>لا يوجد طلاب منسوبون لهذا الفصل.</p>
        </div>
      }

      {!selectedClassId || !selectedInstructorId ? (
        <div className="text-center text-gray-500 p-6 bg-white rounded-lg shadow-md rounded-md">
          <p>الرجاء اختيار **الفصل** و**المدرب** لعرض قائمة الطلاب وتسجيل الحضور.</p>
        </div>
      ) : null}

    </div>
  );
};


// CertificatesPage component: Placeholder for certificates management.
const CertificatesPage = () => (
  <div className="text-center text-gray-600 text-2xl p-10">
    <h2 className="text-3xl font-semibold text-gray-700 mb-4">إدارة الشهادات</h2>
    <p>هذه الصفحة مخصصة لإنشاء وإدارة الشهادات للطلاب. (قريباً...)</p>
    <div className="mt-8">
      <img
        src="https://placehold.co/400x200/E0F2F7/0288D1?text=Certificates+Coming+Soon"
        alt="[Image of Certificates Coming Soon]"
        className="mx-auto rounded-lg shadow-md rounded-md"
      />
    </div>
  </div>
);

// PlaceholderPage component: A generic component for pages that are not yet implemented.
const PlaceholderPage = ({ title }) => (
  <div className="text-center text-gray-600 text-2xl p-10">
    صفحة {title} (قريباً...)
  </div>
);

// ==================================================================================================
// --- MAIN APP CONTENT COMPONENT ---
// This component now contains all the logic that depends on Firebase and Notification Context.
// ==================================================================================================
const AppContent = ({ db, auth, userId, isAuthReady }) => {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [userRole, setUserRole] = useState('admin'); // Moved here from App
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);

  // Use useNotification hook after NotificationContext is provided
  const { addToast } = useNotification();

  // Use custom hook for each collection
  const { data: students, loading: studentsLoading, error: studentsError, addDocument: addStudentDoc, updateDocument: updateStudentDoc, deleteDocument: deleteStudentDoc } = useFirestore(db, isAuthReady, 'students', addToast);
  const { data: classes, loading: classesLoading, error: classesError, addDocument: addClassDoc, updateDocument: updateClassDoc, deleteDocument: deleteClassDoc } = useFirestore(db, isAuthReady, 'classes', addToast);
  const { data: expenses, loading: expensesLoading, error: expensesError, addDocument: addExpenseDoc, updateDocument: updateExpenseDoc, deleteDocument: deleteExpenseDoc } = useFirestore(db, isAuthReady, 'expenses', addToast);
  const { data: courses, loading: coursesLoading, error: coursesError, addDocument: addCourseDoc, updateDocument: updateCourseDoc, deleteDocument: deleteCourseDoc } = useFirestore(db, isAuthReady, 'courses', addToast);
  const { data: instructors, loading: instructorsLoading, error: instructorsError, addDocument: addInstructorDoc, updateDocument: updateInstructorDoc, deleteDocument: deleteInstructorDoc } = useFirestore(db, isAuthReady, 'instructors', addToast);
  const { data: payments, loading: paymentsLoading, error: paymentsError, addDocument: addPaymentDoc, updateDocument: updatePaymentDoc, deleteDocument: deletePaymentDoc } = useFirestore(db, isAuthReady, 'payments', addToast);
  const { data: attendances, loading: attendancesLoading, error: attendancesError, addDocument: addAttendanceDoc } = useFirestore(db, isAuthReady, 'attendance', addToast);


  // Function to show the custom confirmation modal
  const showConfirmModal = (message, action) => {
    setConfirmMessage(message);
    setConfirmAction(() => action); // Use a function to store the action
    setShowConfirm(true);
  };

  // Function to handle confirmation
  const handleConfirm = () => {
    if (confirmAction) {
      confirmAction();
    }
    setShowConfirm(false);
    setConfirmAction(null);
    setConfirmMessage('');
  };

  // Function to handle cancellation
  const handleCancel = () => {
    setShowConfirm(false);
    setConfirmAction(null);
    setConfirmMessage('');
  };

  // Combined loading state for all data
  const overallLoading = studentsLoading || classesLoading || expensesLoading || coursesLoading || instructorsLoading || paymentsLoading || attendancesLoading;


  // Firestore operations for Students (using the custom hook)
  const addStudent = async (newStudent) => {
    const studentId = await addStudentDoc(newStudent);
    if (studentId && newStudent.classId) {
      const currentClass = classes.find(cls => cls.id === newStudent.classId);
      if (currentClass) {
        const updatedStudentsInClass = [...(currentClass.students || []), studentId];
        await updateClassDoc(newStudent.classId, { students: updatedStudentsInClass });
      }
    }
  };

  const updateStudent = async (studentId, updatedData) => {
    const oldStudent = students.find(s => s.id === studentId);
    const oldClassId = oldStudent ? oldStudent.classId : null;
    const newClassId = updatedData.classId;

    await updateStudentDoc(studentId, updatedData);

    if (oldClassId !== newClassId) {
      // Remove from old class
      if (oldClassId) {
        const oldClass = classes.find(cls => cls.id === oldClassId);
        if (oldClass) {
          const updatedStudentsInOldClass = (oldClass.students || []).filter(id => id !== studentId);
          await updateClassDoc(oldClassId, { students: updatedStudentsInOldClass });
        }
      }
      // Add to new class
      if (newClassId) {
        const newClass = classes.find(cls => cls.id === newClassId);
        if (newClass) {
          const updatedStudentsInNewClass = [...(newClass.students || []), studentId];
          await updateClassDoc(newClassId, { students: updatedStudentsInNewClass });
        }
      }
    }
  };

  const deleteStudent = async (studentId) => {
    const studentToDelete = students.find(s => s.id === studentId);
    const classIdOfStudent = studentToDelete ? studentToDelete.classId : null;

    await deleteStudentDoc(studentId);

    if (classIdOfStudent) {
      const currentClass = classes.find(cls => cls.id === classIdOfStudent);
      if (currentClass) {
        const updatedStudentsInClass = (currentClass.students || []).filter(id => id !== studentId);
        await updateClassDoc(classIdOfStudent, { students: updatedStudentsInClass });
      }
    }
  };

  // Firestore operations for Classes (using the custom hook)
  const addClass = async (newClass) => {
    await addClassDoc({ ...newClass, students: [], instructors: [] });
  };

  const updateClass = async (classId, updatedData) => {
    await updateClassDoc(classId, updatedData);
  };

  const deleteClass = async (classId) => {
    // Before deleting a class, remove it from any students assigned to it
    const studentsInClass = students.filter(s => s.classId === classId);
    for (const student of studentsInClass) {
      await updateStudentDoc(student.id, { ...student, classId: null }); // Unassign student from this class
    }
    await deleteClassDoc(classId);
  };

  // Firestore operations for Expenses (using the custom hook)
  const addExpense = async (newExpense) => {
    await addExpenseDoc({ ...newExpense, date: Timestamp.fromDate(newExpense.date) });
  };

  const updateExpense = async (expenseId, updatedData) => {
    await updateExpenseDoc(expenseId, { ...updatedData, date: Timestamp.fromDate(updatedData.date) });
  };

  const deleteExpense = async (expenseId) => {
    await deleteExpenseDoc(expenseId);
  };

  // Firestore operations for Courses (using the custom hook)
  const addCourse = async (newCourse) => {
    await addCourseDoc(newCourse);
  };

  const updateCourse = async (courseId, updatedData) => {
    await updateCourseDoc(courseId, updatedData);
  };

  const deleteCourse = async (courseId) => {
    await deleteCourseDoc(courseId);
  };

  // Firestore operations for Instructors (using the custom hook)
  const addInstructor = async (newInstructor) => {
    await addInstructorDoc(newInstructor);
  };

  const updateInstructor = async (instructorId, updatedData) => {
    await updateInstructorDoc(instructorId, updatedData);
  };

  const deleteInstructor = async (instructorId) => {
    await deleteInstructorDoc(instructorId);
  };

  // Firestore operations for Payments (using the custom hook)
  const addPayment = async (newPayment) => {
    await addPaymentDoc({ ...newPayment, date: Timestamp.fromDate(newPayment.date) });
  };

  const updatePayment = async (paymentId, updatedData) => {
    await updatePaymentDoc(paymentId, { ...updatedData, date: Timestamp.fromDate(updatedData.date) });
  };

  const deletePayment = async (paymentId) => {
    await deletePaymentDoc(paymentId);
  };

  // Firestore operations for Attendance (using the custom hook)
  const addAttendance = async (newAttendanceRecord) => {
    // For attendance, we use setDoc with merge to either create or update a record
    // The ID is composed of studentId, classId, instructorId, and date for uniqueness per day per student per class per instructor
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const attendanceCollectionRef = collection(db, `artifacts/${appId}/public/data/attendance`);
    const attendanceDocId = `${newAttendanceRecord.studentId}-${newAttendanceRecord.classId}-${newAttendanceRecord.instructorId}-${newAttendanceRecord.date.toISOString().split('T')[0]}`;
    const attendanceDocRef = doc(attendanceCollectionRef, attendanceDocId);

    try {
      await setDoc(attendanceDocRef, {
        ...newAttendanceRecord,
        date: Timestamp.fromDate(newAttendanceRecord.date),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }, { merge: true });
      addToast("تم حفظ سجل الحضور بنجاح!", "success");
    } catch (e) {
      console.error("Error adding/updating attendance record: ", e);
      addToast(`خطأ في حفظ سجل الحضور: ${e.message}`, "error");
    }
  };


  // Main render logic based on activeSection
  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return <ReportsPage students={students} classes={classes} expenses={expenses} courses={courses} payments={payments} addToast={addToast} />;
      case 'students':
        return (
          <StudentsPage
            students={students}
            classes={classes}
            addStudent={addStudent}
            updateStudent={updateStudent}
            deleteStudent={deleteStudent}
            showConfirmModal={showConfirmModal}
          />
        );
      case 'classes':
        return (
          <ClassesPage
            classes={classes}
            students={students}
            instructors={instructors}
            addClass={addClass}
            updateClass={updateClass}
            deleteClass={deleteClass}
            showConfirmModal={showConfirmModal}
          />
        );
      case 'courses':
        return (
          <CoursesPage
            courses={courses}
            addCourse={addCourse}
            updateCourse={updateCourse}
            deleteCourse={deleteCourse}
            showConfirmModal={showConfirmModal}
          />
        );
      case 'payments':
        return (
          <PaymentsPage
            payments={payments}
            addPayment={addPayment}
            updatePayment={updatePayment}
            deletePayment={deletePayment}
            students={students}
            courses={courses}
            showConfirmModal={showConfirmModal}
          />
        );
      case 'expenses':
        return (
          <ExpensesPage
            expenses={expenses}
            addExpense={addExpense}
            updateExpense={updateExpense}
            deleteExpense={deleteExpense}
            showConfirmModal={showConfirmModal}
          />
        );
      case 'reports':
        return <ReportsPage students={students} classes={classes} expenses={expenses} courses={courses} payments={payments} addToast={addToast} />;
      case 'instructors':
        return (
          <InstructorsPage
            instructors={instructors}
            courses={courses}
            addInstructor={addInstructor}
            updateInstructor={updateInstructor}
            deleteInstructor={deleteInstructor}
            showConfirmModal={showConfirmModal}
          />
        );
      case 'attendance':
        return (
          <AttendancePage
            students={students}
            classes={classes}
            instructors={instructors}
            attendances={attendances}
            addAttendance={addAttendance}
            addToast={addToast}
          />
        );
      case 'certificates':
        return <CertificatesPage />;
      default:
        return <ReportsPage students={students} classes={classes} expenses={expenses} courses={courses} payments={payments} addToast={addToast} />;
    }
  };

  return (
    <DashboardLayout
      activeSection={activeSection}
      setActiveSection={setActiveSection}
      userId={userId}
      userRole={userRole}
      setUserRole={setUserRole}
    >
      {overallLoading && <LoadingSpinner />} {/* Show loading spinner when isLoading is true */}
      {renderContent()}
      {showConfirm && (
        <ConfirmModal
          message={confirmMessage}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </DashboardLayout>
  );
};

// ==================================================================================================
// --- MAIN APP COMPONENT (Entry Point) ---
// This component now handles Firebase initialization and passes props to AppContent.
// ==================================================================================================
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoadingApp, setIsLoadingApp] = useState(true); // Overall app loading state

  // Firebase Initialization
  useEffect(() => {
    const initFirebase = async () => {
      try {
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const firebaseAuth = getAuth(app);

        setDb(firestore);
        setAuth(firebaseAuth);

        const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
          if (user) {
            setUserId(user.uid);
          } else {
            // Sign in anonymously if no user is authenticated
            if (typeof __initial_auth_token !== 'undefined') {
              await signInWithCustomToken(firebaseAuth, __initial_auth_token);
            } else {
              await signInAnonymously(firebaseAuth);
            }
            // After anonymous sign-in, onAuthStateChanged will fire again with a user
            // So we don't need to set userId here immediately for anonymous.
            // Let the next onAuthStateChanged trigger handle it.
          }
          setIsAuthReady(true);
          setIsLoadingApp(false); // App is ready after auth state is determined
        });
        return () => unsubscribeAuth(); // Cleanup function for onAuthStateChanged
      } catch (error) {
        console.error("Error initializing Firebase:", error);
        setIsLoadingApp(false); // Ensure loading is false even on error
      }
    };

    initFirebase();
  }, []);


  return (
    <ToastContainer>
      {/* Pass Firebase instances and auth status to AppContent */}
      {isAuthReady ? (
        <AppContent
          db={db}
          auth={auth}
          userId={userId}
          isAuthReady={isAuthReady}
        />
      ) : (
        <LoadingSpinner /> // Show a global loading spinner while Firebase is initializing
      )}
    </ToastContainer>
  );
};

export default App;


// ==================================================================================================
// --- PAGES ---
// ==================================================================================================

// StudentsPage component: Manages student records.
const StudentsPage = ({ students, classes, addStudent, updateStudent, deleteStudent, showConfirmModal }) => {
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showEditStudentModal, setShowEditStudentModal] = useState(false);
  const [currentStudent, setCurrentStudent] = useState(null);
  const [searchTerm, setSearchTerm] = useState(''); // New state for search term

  const handleEditClick = (student) => {
    setCurrentStudent(student);
    setShowEditStudentModal(true);
  };

  const handleDeleteClick = (studentId) => {
    showConfirmModal("هل أنت متأكد أنك تريد حذف هذا الطالب؟", () => deleteStudent(studentId));
  };

  // Filter students based on search term
  const filteredStudents = students.filter(student =>
    student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.phone.includes(searchTerm) ||
    (student.email && student.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-700">إدارة الطلاب</h2>
        <div className="flex items-center space-x-4">
          <input
            type="text"
            placeholder="بحث بالاسم، الهاتف، أو البريد الإلكتروني..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm w-80 rounded-md"
          />
          <button
            onClick={() => setShowAddStudentModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
          >
            + إضافة طالب جديد
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden rounded-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الاسم
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الهاتف
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                البريد الإلكتروني
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                حالة الدفع
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الفصل
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                النوع
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الإجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                  لا يوجد طلاب مسجلون أو مطابقون لبحثك.
                </td>
              </tr>
            ) : (
              filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {student.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {student.phone}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {student.email || 'لا يوجد'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        student.paid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      } rounded-full`}
                    >
                      {student.paid ? 'مدفوع' : 'غير مدفوع'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {student.classId ? classes.find(cls => cls.id === student.classId)?.name || 'غير معروف' : 'غير منسّب'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {student.studentType === 'local' ? 'محلي' : 'دولي'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEditClick(student)}
                      className="text-blue-600 hover:text-blue-900 ml-4"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleDeleteClick(student.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddStudentModal && (
        <AddStudentModal
          onClose={() => setShowAddStudentModal(false)}
          onAddStudent={addStudent}
          classes={classes}
        />
      )}

      {showEditStudentModal && currentStudent && (
        <EditStudentModal
          student={currentStudent}
          onClose={() => setShowEditStudentModal(false)}
          onUpdateStudent={updateStudent}
          classes={classes}
        />
      )}
    </div>
  );
};

// ClassesPage component: Manages classes.
const ClassesPage = ({ classes, students, instructors, addClass, updateClass, deleteClass, showConfirmModal }) => {
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [showEditClassModal, setShowEditClassModal] = useState(false);
  const [showAssignStudentsModal, setShowAssignStudentsModal] = useState(false);
  const [showAssignInstructorsModal, setShowAssignInstructorsModal] = useState(false);
  const [currentClass, setCurrentClass] = useState(null);

  const handleEditClick = (cls) => {
    setCurrentClass(cls);
    setShowEditClassModal(true);
  };

  const handleDeleteClick = (classId) => {
    showConfirmModal("هل أنت متأكد أنك تريد حذف هذا الفصل؟ سيتم إزالة جميع الطلاب المنسوبين إليه من هذا الفصل.", () => deleteClass(classId));
  };

  const handleAssignStudentsClick = (cls) => {
    setCurrentClass(cls);
    setShowAssignStudentsModal(true);
  };

  const handleAssignInstructorsClick = (cls) => {
    setCurrentClass(cls);
    setShowAssignInstructorsModal(true);
  };

  const getAssignedStudentsNames = (classStudentsIds) => {
    if (!classStudentsIds || classStudentsIds.length === 0) return 'لا يوجد';
    const assignedStudents = students.filter(s => classStudentsIds.includes(s.id));
    return assignedStudents.map(s => s.name).join(', ') || 'لا يوجد';
  };

  const getAssignedInstructorsNames = (classInstructorsIds) => {
    if (!classInstructorsIds || classInstructorsIds.length === 0) return 'لا يوجد';
    const assignedInstructors = instructors.filter(i => classInstructorsIds.includes(i.id));
    return assignedInstructors.map(i => i.name).join(', ') || 'لا يوجد';
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-700">إدارة الفصول</h2>
        <button
          onClick={() => setShowAddClassModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
        >
          + إنشاء فصل جديد
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden rounded-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                اسم الفصل
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الوصف
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الطلاب المنسوبون
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                المدربون المنسوبون
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الإجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {classes.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                  لا توجد فصول مسجلة بعد.
                </td>
              </tr>
            ) : (
              classes.map((cls) => (
                <tr key={cls.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {cls.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {cls.description || 'لا يوجد وصف'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {getAssignedStudentsNames(cls.students)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {getAssignedInstructorsNames(cls.instructors)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleAssignStudentsClick(cls)}
                      className="text-green-600 hover:text-green-900 ml-4"
                    >
                      تنسيب طلاب
                    </button>
                    <button
                      onClick={() => handleAssignInstructorsClick(cls)}
                      className="text-purple-600 hover:text-purple-900 ml-4"
                    >
                      تنسيب مدربين
                    </button>
                    <button
                      onClick={() => handleEditClick(cls)}
                      className="text-blue-600 hover:text-blue-900 ml-4"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleDeleteClick(cls.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddClassModal && (
        <AddClassModal onClose={() => setShowAddClassModal(false)} onAddClass={addClass} />
      )}

      {showEditClassModal && currentClass && (
        <EditClassModal
          cls={currentClass}
          onClose={() => setShowEditClassModal(false)}
          onUpdateClass={updateClass}
        />
      )}

      {showAssignStudentsModal && currentClass && (
        <AssignStudentsToClassModal
          cls={currentClass}
          students={students}
          onClose={() => setShowAssignStudentsModal(false)}
          onUpdateClass={updateClass}
        />
      )}

      {showAssignInstructorsModal && currentClass && (
        <AssignInstructorsToClassModal
          cls={currentClass}
          instructors={instructors}
          onClose={() => setShowAssignInstructorsModal(false)}
          onUpdateClass={updateClass}
        />
      )}
    </div>
  );
};

// CoursesPage component: Manages courses.
const CoursesPage = ({ courses, addCourse, updateCourse, deleteCourse, showConfirmModal }) => {
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [showEditCourseModal, setShowEditCourseModal] = useState(false);
  const [currentCourse, setCurrentCourse] = useState(null);

  const handleEditClick = (course) => {
    setCurrentCourse(course);
    setShowEditCourseModal(true);
  };

  const handleDeleteClick = (courseId) => {
    showConfirmModal("هل أنت متأكد أنك تريد حذف هذه الدورة؟", () => deleteCourse(courseId));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-700">إدارة الدورات</h2>
        <button
          onClick={() => setShowAddCourseModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
        >
          + إضافة دورة جديدة
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden rounded-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                اسم الدورة
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                السعر (د.ل)
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الوصف
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الإجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {courses.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                  لا توجد دورات مسجلة بعد.
                </td>
              </tr>
            ) : (
              courses.map((course) => (
                <tr key={course.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {course.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {course.price.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {course.description || 'لا يوجد وصف'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEditClick(course)}
                      className="text-blue-600 hover:text-blue-900 ml-4"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleDeleteClick(course.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddCourseModal && (
        <AddCourseModal onClose={() => setShowAddCourseModal(false)} onAddCourse={addCourse} />
      )}

      {showEditCourseModal && currentCourse && (
        <EditCourseModal
          course={currentCourse}
          onClose={() => setShowEditCourseModal(false)}
          onUpdateCourse={updateCourse}
        />
      )}
    </div>
  );
};

// ExpensesPage component: Manages expense records.
const ExpensesPage = ({ expenses, addExpense, updateExpense, deleteExpense, showConfirmModal }) => {
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showEditExpenseModal, setShowEditExpenseModal] = useState(false);
  const [currentExpense, setCurrentExpense] = useState(null);

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const handleEditClick = (expense) => {
    setCurrentExpense(expense);
    setShowEditExpenseModal(true);
  };

  const handleDeleteClick = (expenseId) => {
    showConfirmModal("هل أنت متأكد أنك تريد حذف هذا المصروف؟", () => deleteExpense(expenseId));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-700">إدارة المصاريف</h2>
        <button
          onClick={() => setShowAddExpenseModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
        >
          + إضافة مصروف جديد
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden rounded-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الوصف
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                المبلغ (د.ل)
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الفئة
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                التاريخ
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الإجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {expenses.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                  لا يوجد مصاريف مسجلة بعد.
                </td>
              </tr>
            ) : (
              expenses.map((expense) => (
                <tr key={expense.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {expense.description}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {expense.amount.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {expense.category}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(expense.date)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEditClick(expense)}
                      className="text-blue-600 hover:text-blue-900 ml-4"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleDeleteClick(expense.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddExpenseModal && (
        <AddExpenseModal onClose={() => setShowAddExpenseModal(false)} onAddExpense={addExpense} />
      )}

      {showEditExpenseModal && currentExpense && (
        <EditExpenseModal
          expense={currentExpense}
          onClose={() => setShowEditExpenseModal(false)}
          onUpdateExpense={updateExpense}
        />
      )}
    </div>
  );
};

// InstructorsPage component: Manages instructor records.
const InstructorsPage = ({ instructors, courses, addInstructor, updateInstructor, deleteInstructor, showConfirmModal }) => {
  const [showAddInstructorModal, setShowAddInstructorModal] = useState(false);
  const [showEditInstructorModal, setShowEditInstructorModal] = useState(false);
  const [currentInstructor, setCurrentInstructor] = useState(null);

  const handleEditClick = (instructor) => {
    setCurrentInstructor(instructor);
    setShowEditInstructorModal(true);
  };

  const handleDeleteClick = (instructorId) => {
    showConfirmModal("هل أنت متأكد أنك تريد حذف هذا المدرب؟", () => deleteInstructor(instructorId));
  };

  const getCourseRateDisplay = (instructorCourseRates) => {
    if (!instructorCourseRates || Object.keys(instructorCourseRates).length === 0) {
      return 'لا يوجد أجور محددة';
    }
    return Object.entries(instructorCourseRates)
      .map(([courseId, rate]) => {
        const course = courses.find(c => c.id === courseId);
        return course ? `${course.name}: ${rate.toLocaleString()} د.ل` : null;
      })
      .filter(Boolean)
      .join(', ') || 'لا يوجد أجور محددة';
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-700">إدارة المدربين</h2>
        <button
          onClick={() => setShowAddInstructorModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md"
        >
          + إضافة مدرب جديد
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden rounded-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الاسم
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الهاتف
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                البريد الإلكتروني
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                التخصص
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                أجور الدورات
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الإجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {instructors.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                  لا يوجد مدربون مسجلون بعد.
                </td>
              </tr>
            ) : (
              instructors.map((instructor) => (
                <tr key={instructor.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {instructor.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {instructor.phone}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {instructor.email || 'لا يوجد'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {instructor.specialty || 'لا يوجد'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {getCourseRateDisplay(instructor.courseRates)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEditClick(instructor)}
                      className="text-blue-600 hover:text-blue-900 ml-4"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleDeleteClick(instructor.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddInstructorModal && (
        <AddInstructorModal onClose={() => setShowAddInstructorModal(false)} onAddInstructor={addInstructor} courses={courses} />
      )}

      {showEditInstructorModal && currentInstructor && (
        <EditInstructorModal
          instructor={currentInstructor}
          onClose={() => setShowEditInstructorModal(false)}
          onUpdateInstructor={updateInstructor}
          courses={courses}
        />
      )}
    </div>
  );
};