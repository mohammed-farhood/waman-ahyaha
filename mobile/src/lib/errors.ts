// Server errors are English; users see Arabic. Port of the website's js/errors.js (keep the two in sync).
const EXACT: Record<string, string> = {
  'phone or PIN incorrect': 'رقم الهاتف أو رمز الدخول غير صحيح',
  'account locked, try again later': 'تم قفل الحساب مؤقتاً، حاول لاحقاً',
  'session expired': 'انتهت جلستك، يرجى تسجيل الدخول مجدداً',
  'no refresh token': 'انتهت جلستك، يرجى تسجيل الدخول مجدداً',
  unauthenticated: 'يجب تسجيل الدخول للمتابعة',
  'token expired or invalid': 'انتهت جلستك، يرجى تسجيل الدخول مجدداً',
  'user not found': 'المستخدم غير موجود',
  'current PIN incorrect': 'رمز الدخول الحالي غير صحيح',
  forbidden: 'ليس لديك صلاحية لهذا الإجراء',
  'forbidden: cross-group access': 'لا يمكنك الوصول إلى بيانات مجموعة أخرى',
  'only superadmin can create admins': 'إنشاء المديرين متاح للمدير العام فقط',
  'cannot edit admin/superadmin': 'لا يمكن تعديل بيانات المديرين',
  'cannot delete admin/superadmin': 'لا يمكن حذف المديرين',
  'superadmin cannot self-delete': 'لا يمكن للمدير العام حذف نفسه',
  'phone already registered': 'رقم الهاتف مسجل مسبقاً',
  'invalid phone number': 'رقم الهاتف غير صالح',
  'phone required': 'رقم الهاتف مطلوب',
  'chatId required': 'معرف المحادثة مطلوب',
  'not found': 'العنصر المطلوب غير موجود',
  'Not found': 'العنصر المطلوب غير موجود',
  'nothing to update': 'لا يوجد تغييرات للحفظ',
  'invalid CSRF token': 'فشل التحقق الأمني، أعد تشغيل التطبيق',
  'CORS: origin not allowed': 'الاتصال بالخادم مرفوض',
  'Internal server error': 'خطأ في الخادم، يرجى المحاولة لاحقاً',
  'Too many requests, try again later.': 'محاولات كثيرة جداً، انتظر قليلاً وحاول مجدداً',
  'request too large': 'الملف أو البيانات أكبر من المسموح',
  'invalid JSON': 'بيانات غير صالحة',
  'PIN too weak': 'رمز الدخول سهل التخمين، اختر رمزاً آخر (ليس 0000 أو 1234)',
  'unknown campaign': 'الحملة غير موجودة',
  'collector not in this campaign': 'مسؤول الجمع لا يتبع هذه الحملة',
  'donor not in this campaign': 'المتبرع لا يتبع هذه الحملة',
  'donor not in this group': 'المتبرع لا يتبع هذه الحملة',
  'forbidden: not your donor': 'هذا المتبرع ليس ضمن قائمتك',
  'forbidden: chat not in this campaign': 'لا يمكن الإرسال لمستخدم خارج الحملة',
  'telegram bot not configured': 'بوت التليجرام غير مفعّل حالياً',
  'invalid bot token': 'التوكن غير صالح — تأكد أنك نسخته كاملاً من BotFather',
  'code not linked': 'لم يكتمل الربط مع التليجرام، حاول مجدداً',
  'code not found': 'انتهت صلاحية رمز الربط، حاول مجدداً',
  'content or image required': 'الرجاء كتابة المحتوى أو إرفاق صورة',
  'groupId required': 'يرجى اختيار الحملة',
  'already exists': 'هذا العنصر موجود مسبقاً',
  'referenced record not found': 'بيانات مرتبطة غير موجودة',
  'invalid value': 'قيمة غير صالحة',
};

const FIELDS: Record<string, string> = {
  name: 'الاسم',
  phone: 'رقم الهاتف',
  pin: 'رمز الدخول',
  oldPin: 'رمز الدخول الحالي',
  newPin: 'رمز الدخول الجديد',
  groupId: 'الحملة',
  collectorId: 'مسؤول الجمع',
  donorId: 'المتبرع',
  amount: 'المبلغ',
  university: 'اسم الجامعة/الكلية',
  title: 'العنوان',
  content: 'المحتوى',
  type: 'النوع',
  code: 'الرمز',
  province: 'المحافظة',
  birthDate: 'تاريخ الميلاد',
  notes: 'الملاحظات',
  note: 'الملاحظة',
  body: 'النص',
  stage: 'المرحلة',
  isAnonymous: 'التبرع كفاعل خير',
  availability: 'الجدول الزمني',
  botToken: 'التوكن',
  image: 'الصورة',
};

const BY_STATUS: Record<number, string> = {
  0: 'تعذر الاتصال بالإنترنت، تحقق من اتصالك',
  400: 'البيانات المدخلة غير صالحة',
  401: 'يجب تسجيل الدخول للمتابعة',
  403: 'ليس لديك صلاحية لهذا الإجراء',
  404: 'العنصر المطلوب غير موجود',
  409: 'هذا العنصر موجود مسبقاً',
  413: 'الملف أو البيانات أكبر من المسموح',
  429: 'محاولات كثيرة جداً، انتظر قليلاً وحاول مجدداً',
};
export const GENERIC_ERROR = 'حدث خطأ غير متوقع، حاول مجدداً';

const chars = (n: string) => {
  const x = parseInt(n, 10);
  return x === 1 ? 'حرف واحد' : x === 2 ? 'حرفين' : `${x} أحرف`;
};

export function translateError(raw: string | undefined | null, status: number): string {
  if (raw && EXACT[raw]) return EXACT[raw];
  if (raw) {
    const first = raw.split(';')[0].trim();
    const m0 = first.match(/^([\w.]+):\s*(.+)$/);
    if (m0) {
      const key = m0[1].split('.').pop() || m0[1];
      const label = FIELDS[key] || 'قيمة';
      const d = m0[2];
      let m: RegExpMatchArray | null;
      if ((m = d.match(/at least (\d+) character/i))) return `${label}: يجب أن يكون ${chars(m[1])} على الأقل`;
      if ((m = d.match(/at most (\d+) character/i))) return `${label}: يجب ألا يتجاوز ${chars(m[1])}`;
      if ((m = d.match(/greater than or equal to (\d+)/i))) return `${label}: يجب أن يكون ${m[1]} أو أكثر`;
      if ((m = d.match(/less than or equal to (\d+)/i))) return `${label}: يجب أن يكون ${m[1]} أو أقل`;
      if (/^Required/i.test(d)) return `${label}: حقل مطلوب`;
      if (/^Expected number/i.test(d)) return `${label}: يجب أن يكون رقماً`;
      if (/^Invalid enum value/i.test(d)) return `${label}: قيمة غير مسموح بها`;
      if (/invalid phone/i.test(d)) return `${label}: رقم هاتف غير صالح`;
      if (EXACT[d]) return EXACT[d];
      if (/^Expected|^Invalid/i.test(d)) return `${label}: قيمة غير صالحة`;
    }
  }
  if (status >= 500) return EXACT['Internal server error'];
  return BY_STATUS[status] || GENERIC_ERROR;
}
