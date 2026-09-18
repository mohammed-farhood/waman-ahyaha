/* AL-AYN — Error message translator (server English → Arabic for end users)
 *
 * Usage:
 *   Errors.t('phone or PIN incorrect')   → 'رقم الهاتف أو رمز الدخول غير صحيح'
 *   Errors.t(err)                        → translated string (err can be Error or string)
 *
 * apiClient wraps every thrown error through this; `err.message` is Arabic and
 * `err.serverMessage` is the original English (kept for console.error / debug).
 *
 * Unknown messages fall through unchanged — never lose information.
 */

const Errors = {
  // ── Exact-match table for messages the backend actually returns ─────────
  _exact: {
    // Auth
    'phone or PIN incorrect':            'رقم الهاتف أو رمز الدخول غير صحيح',
    'account locked, try again later':   'تم قفل الحساب مؤقتاً، حاول لاحقاً',
    'session expired':                   'انتهت جلستك، يرجى تسجيل الدخول مجدداً',
    'no refresh token':                  'انتهت جلستك، يرجى تسجيل الدخول مجدداً',
    'unauthenticated':                   'يجب تسجيل الدخول للمتابعة',
    'token expired or invalid':          'انتهت جلستك، يرجى تسجيل الدخول مجدداً',
    'user not found':                    'المستخدم غير موجود',
    'current PIN incorrect':             'رمز الدخول الحالي غير صحيح',

    // Authorization
    'forbidden':                         'ليس لديك صلاحية لهذا الإجراء',
    'forbidden: cross-group access':     'لا يمكنك الوصول إلى بيانات مجموعة أخرى',
    'only superadmin can create admins': 'إنشاء المديرين متاح للمدير العام فقط',
    'cannot edit admin/superadmin':      'لا يمكن تعديل بيانات المديرين',
    'cannot delete admin/superadmin':    'لا يمكن حذف المديرين',
    'superadmin cannot self-delete':     'لا يمكن للمدير العام حذف نفسه',

    // Registration / data
    'phone already registered':          'رقم الهاتف مسجل مسبقاً',
    'invalid phone number':              'رقم الهاتف غير صالح',
    'phone required':                    'رقم الهاتف مطلوب',
    'chatId required':                   'معرف المحادثة مطلوب',

    // CRUD generic
    'not found':                         'العنصر المطلوب غير موجود',
    'Not found':                         'الصفحة غير موجودة',
    'nothing to update':                 'لا يوجد تغييرات للحفظ',

    // Security / infra
    'invalid CSRF token':                'فشل التحقق الأمني، يرجى تحديث الصفحة',
    'CORS: origin not allowed':          'الاتصال بالخادم مرفوض',
    'export limited to 5 times per day': 'التصدير متاح 5 مرات فقط في اليوم',
    'Internal server error':             'خطأ في الخادم، يرجى المحاولة لاحقاً',
    'Too many requests, try again later.': 'محاولات كثيرة جداً، انتظر قليلاً وحاول مجدداً',
    'request too large':                 'الملف أو البيانات أكبر من المسموح',
    'invalid JSON':                      'بيانات غير صالحة',

    // Added with the server fixes
    'PIN too weak':                      'رمز الدخول سهل التخمين، اختر رمزاً آخر (ليس 0000 أو 1234)',
    'unknown campaign':                  'الحملة غير موجودة',
    'collector not in this campaign':    'مسؤول الجمع لا يتبع هذه الحملة',
    'donor not in this campaign':        'المتبرع لا يتبع هذه الحملة',
    'donor not in this group':           'المتبرع لا يتبع هذه الحملة',
    'forbidden: not your donor':         'هذا المتبرع ليس ضمن قائمتك',
    'forbidden: chat not in this campaign': 'لا يمكن الإرسال لمستخدم خارج الحملة',
    'telegram bot not configured':       'بوت التليجرام غير مفعّل حالياً',
    'invalid bot token':                 'التوكن غير صالح — تأكد أنك نسخته كاملاً من BotFather',
    'code not linked':                   'لم يكتمل الربط مع التليجرام، حاول مجدداً',
    'content or image required':         'الرجاء كتابة المحتوى أو إرفاق صورة',
    'groupId required':                  'يرجى اختيار الحملة',
    'already exists':                    'هذا العنصر موجود مسبقاً',
    'referenced record not found':       'بيانات مرتبطة غير موجودة',
    'invalid value':                     'قيمة غير صالحة',
  },

  // ── Form field labels (for Zod validation errors that prefix the field name)
  _fields: {
    name:         'الاسم',
    phone:        'رقم الهاتف',
    pin:          'رمز الدخول',
    oldPin:       'رمز الدخول الحالي',
    newPin:       'رمز الدخول الجديد',
    groupId:      'الحملة',
    collectorId:  'مسؤول الجمع',
    amount:       'المبلغ',
    university:   'اسم الجامعة/الكلية',
    icon:         'الأيقونة',
    title:        'العنوان',
    content:      'المحتوى',
    type:         'النوع',
    code:         'الرمز',
    province:     'المحافظة',
    birthDate:    'تاريخ الميلاد',
    notes:        'الملاحظات',
    status:       'الحالة',
    chatId:       'معرف المحادثة',
    subject:      'الموضوع',
    body:         'النص',
    role:         'الدور',
    stage:        'المرحلة',
    isAnonymous:  'التبرع كفاعل خير',
    availability: 'الجدول الزمني',
    orphansSponsored: 'عدد الأيتام المكفولين',
    costPerOrphan:    'كلفة اليتيم',
    defaultPledge:    'التبرع الافتراضي',
    monthlyGoal:      'الهدف الشهري',
  },

  _fieldLabel(key) { return this._fields[key] || key; },

  // ── Public API ───────────────────────────────────────────────────────────
  t(err) {
    const raw = (err && err.message) || (typeof err === 'string' ? err : '');
    if (!raw) return 'حدث خطأ غير متوقع';

    // 1) Exact match
    if (this._exact[raw]) return this._exact[raw];

    // 2) Zod field-validation errors, format "fieldname: detail"
    //    (validate middleware joins multi-field errors with "; "; handle the first)
    const first = raw.split(';')[0].trim();
    const fieldMatch = first.match(/^(\w+):\s*(.+)$/);
    if (fieldMatch) {
      const label  = this._fieldLabel(fieldMatch[1]);
      const detail = fieldMatch[2];
      // Arabic noun-with-count: 1 → "حرف واحد", 2 → "حرفين" (dual), 3+ → "N أحرف".
      const chars = (n) => {
        const x = parseInt(n);
        return x === 1 ? 'حرف واحد' : x === 2 ? 'حرفين' : `${x} أحرف`;
      };
      let m;
      if ((m = detail.match(/String must contain at least (\d+) character/i)))
        return `${label}: يجب أن يكون ${chars(m[1])} على الأقل`;
      if ((m = detail.match(/String must contain at most (\d+) character/i)))
        return `${label}: يجب ألا يتجاوز ${chars(m[1])}`;
      if ((m = detail.match(/Number must be greater than or equal to (\d+)/i)))
        return `${label}: يجب أن يكون ${m[1]} أو أكثر`;
      if ((m = detail.match(/Number must be less than or equal to (\d+)/i)))
        return `${label}: يجب أن يكون ${m[1]} أو أقل`;
      if (/^Required/i.test(detail))           return `${label}: حقل مطلوب`;
      if (/^Expected number/i.test(detail))    return `${label}: يجب أن يكون رقماً`;
      if (/^Expected string/i.test(detail))    return `${label}: قيمة غير صالحة`;
      if (/^Expected boolean/i.test(detail))   return `${label}: قيمة غير صالحة`;
      if (/^Invalid enum value/i.test(detail)) return `${label}: قيمة غير مسموح بها`;
      if (/invalid phone/i.test(detail))       return `${label}: رقم هاتف غير صالح`;
      if (/PIN too weak/i.test(detail))        return this._exact['PIN too weak'];
      if (/invalid bot token/i.test(detail))   return this._exact['invalid bot token'];
      if (/content or image required/i.test(detail)) return this._exact['content or image required'];
      // Fall through to raw if the detail shape is unknown
    }

    // 3) HTTP-status fallbacks (thrown by apiClient as "HTTP NNN")
    if (/^HTTP 5\d\d/.test(raw)) return 'خطأ في الخادم، يرجى المحاولة لاحقاً';
    if (/^HTTP 429/.test(raw))   return 'محاولات كثيرة جداً، انتظر قليلاً وحاول مجدداً';
    if (/^HTTP 404/.test(raw))   return 'المورد المطلوب غير موجود';
    if (/^HTTP 403/.test(raw))   return 'ليس لديك صلاحية لهذا الإجراء';
    if (/^HTTP 401/.test(raw))   return 'يجب تسجيل الدخول للمتابعة';
    if (/^HTTP 400/.test(raw))   return 'البيانات المدخلة غير صالحة';

    // 4) Network / fetch errors
    if (/^network error/i.test(raw)) return 'تعذر الاتصال بالإنترنت، تحقق من اتصالك';

    // Unknown — keep the original so devs can still debug from the toast
    return raw;
  },
};
