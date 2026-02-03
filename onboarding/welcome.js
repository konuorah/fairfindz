(() => {
  const stepsEl = document.getElementById('steps');
  const progressEl = document.getElementById('progress');
  const openAmazonBtn = document.getElementById('openAmazon');
  const startShoppingBtn = document.getElementById('startShopping');

  if (!stepsEl || !progressEl) return;

  const steps = Array.from(stepsEl.querySelectorAll('.step'));
  const stepperItems = Array.from(progressEl.querySelectorAll('[data-go]'));
  let current = 1;

  const setStep = (n) => {
    const clamped = Math.max(1, Math.min(steps.length, n));
    current = clamped;

    for (const s of steps) {
      const idx = Number(s.getAttribute('data-step') || '0');
      s.classList.toggle('is-active', idx === current);
    }

    for (const item of stepperItems) {
      const idx = Number(item.getAttribute('data-go') || '0');
      item.classList.toggle('is-active', idx === current);
    }
  };

  const advanceOrClose = () => {
    if (current >= steps.length) {
      window.close();
      return;
    }
    setStep(current + 1);
  };

  // Per-step Continue/Skip handlers
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const action = target.getAttribute('data-action');
    if (!action) return;

    e.preventDefault();
    if (action === 'continue' || action === 'skip') {
      advanceOrClose();
    }
  });

  // Bottom stepper navigation
  for (const item of stepperItems) {
    item.addEventListener('click', () => {
      const n = Number(item.getAttribute('data-go') || '1');
      setStep(n);
    });
  }

  if (openAmazonBtn) {
    openAmazonBtn.addEventListener('click', () => {
      window.open('https://www.amazon.com/', '_blank', 'noopener,noreferrer');
    });
  }

  if (startShoppingBtn) {
    startShoppingBtn.addEventListener('click', () => {
      window.open('https://www.amazon.com/', '_blank', 'noopener,noreferrer');
      window.close();
    });
  }

  setStep(1);
})();
