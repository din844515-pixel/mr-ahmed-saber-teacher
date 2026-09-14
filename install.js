(function () {
  let deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function createInstallButton() {
    if (isStandalone() || document.getElementById('pwaInstallButton')) return;

    const button = document.createElement('button');
    button.id = 'pwaInstallButton';
    button.textContent = '📲 تثبيت تطبيق المستر';

    button.style.cssText = [
      'position:fixed',
      'bottom:20px',
      'right:20px',
      'z-index:999999',
      'border:0',
      'border-radius:14px',
      'padding:13px 18px',
      'font-size:16px',
      'font-weight:700',
      'cursor:pointer',
      'box-shadow:0 5px 18px rgba(0,0,0,.25)'
    ].join(';');

    button.addEventListener('click', async function () {
      if (!deferredPrompt) {
        alert(
          'لتثبيت التطبيق: افتحي قائمة المتصفح ⋮ ثم اختاري «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'
        );
        return;
      }

      deferredPrompt.prompt();

      try {
        await deferredPrompt.userChoice;
      } catch (_) {}

      deferredPrompt = null;
      button.remove();
    });

    document.body.appendChild(button);
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    createInstallButton();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    document.getElementById('pwaInstallButton')?.remove();
  });

  window.addEventListener('load', function () {
    if (!isStandalone()) {
      setTimeout(createInstallButton, 1000);
    }
  });
})();
