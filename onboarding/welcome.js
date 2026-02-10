(() => {
  const stepsEl = document.getElementById('steps');
  const progressEl = document.getElementById('progress');
  const openAmazonBtn = document.getElementById('openAmazon');
  const startShoppingBtn = document.getElementById('startShopping');
  const howItWorksStep = document.getElementById('howItWorksStep');
  const finishStep = stepsEl ? stepsEl.querySelector('.step[data-step="6"]') : null;
  const trustStep = stepsEl ? stepsEl.querySelector('.step[data-step="4"]') : null;
  const trustControlStep = document.getElementById('trustControlStep');
  const trustToggleBtn = trustControlStep
    ? trustControlStep.querySelector('[data-role="alt-toggle"]')
    : null;

  // Check if extension was successfully pinned
  const checkPinStatus = async () => {
    try {
      const result = await chrome.storage.local.get(['hasAttemptedPin', 'pinError']);
      return {
        attempted: result.hasAttemptedPin,
        error: result.pinError
      };
    } catch {
      return { attempted: null, error: null };
    }
  };

  const wireImageFallbacks = () => {
    const imgs = Array.from(document.querySelectorAll('img[data-fallback]'));
    for (const img of imgs) {
      img.addEventListener('error', () => {
        const mode = img.getAttribute('data-fallback');
        if (mode === 'hide') {
          img.style.display = 'none';
          return;
        }

        if (mode === 'amazon-thumb') {
          img.style.display = 'none';
          const parent = img.parentElement;
          if (parent) parent.classList.add('is-fallback');
        }

        if (mode === 'ff-thumb') {
          img.style.display = 'none';
          const parent = img.parentElement;
          if (parent) parent.classList.add('is-fallback');
        }
      });
    }
  };

  if (!stepsEl || !progressEl) return;

  const steps = Array.from(stepsEl.querySelectorAll('.step'));
  const stepperItems = Array.from(progressEl.querySelectorAll('[data-go]'));
  let current = 1;

  let howDemoTimer = null;
  const clearHowDemoTimer = () => {
    if (howDemoTimer) {
      window.clearTimeout(howDemoTimer);
      howDemoTimer = null;
    }
  };

  let trustDemoTimer = null;
  const clearTrustDemoTimer = () => {
    if (trustDemoTimer) {
      window.clearTimeout(trustDemoTimer);
      trustDemoTimer = null;
    }
  };

  const setTrustAltOn = (on) => {
    if (!trustControlStep) return;
    trustControlStep.classList.toggle('is-alt-on', Boolean(on));
    if (trustToggleBtn) {
      trustToggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };

  const startTrustControlDemo = () => {
    if (!trustControlStep) return;
    clearTrustDemoTimer();
    trustControlStep.classList.remove('is-nudge');
    setTrustAltOn(false);
    trustControlStep.classList.add('is-fx');
    // Cursor click #1 -> ON, then click #2 -> OFF.
    trustDemoTimer = window.setTimeout(() => {
      setTrustAltOn(true);
      trustDemoTimer = window.setTimeout(() => {
        setTrustAltOn(false);
        trustControlStep.classList.remove('is-fx');
        trustControlStep.classList.add('is-nudge');
        trustDemoTimer = null;
      }, 2400);
    }, 1700);
  };

  const startHowItWorksDemo = () => {
    if (!howItWorksStep) return;
    clearHowDemoTimer();
    howItWorksStep.classList.remove('is-demo-modal');
    // Show scanning first, then reveal modal.
    howDemoTimer = window.setTimeout(() => {
      howItWorksStep.classList.add('is-demo-modal');
      // Reset and loop after a short dwell.
      howDemoTimer = window.setTimeout(() => {
        startHowItWorksDemo();
      }, 2600);
    }, 900);
  };

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

    if (current === 3) {
      startHowItWorksDemo();
    } else {
      clearHowDemoTimer();
      if (howItWorksStep) howItWorksStep.classList.remove('is-demo-modal');
    }

    if (finishStep) {
      finishStep.classList.remove('is-fx');
      if (current === 6) {
        window.requestAnimationFrame(() => {
          finishStep.classList.add('is-fx');
        });
      }
    }

    if (trustStep) {
      trustStep.classList.remove('is-fx');
      clearTrustDemoTimer();
      if (trustControlStep) {
        trustControlStep.classList.remove('is-fx');
        trustControlStep.classList.remove('is-alt-on');
        trustControlStep.classList.remove('is-nudge');
      }
      if (current === 4) {
        window.requestAnimationFrame(() => {
          startTrustControlDemo();
        });
      }
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

  if (trustToggleBtn && trustControlStep) {
    trustToggleBtn.addEventListener('click', () => {
      clearTrustDemoTimer();
      trustControlStep.classList.remove('is-fx');
      trustControlStep.classList.remove('is-nudge');
      const next = !trustControlStep.classList.contains('is-alt-on');
      setTrustAltOn(next);
    });
  }

  wireImageFallbacks();
  
  // Check pin status and show appropriate message
  checkPinStatus().then(pinStatus => {
    if (pinStatus.attempted === true) {
      console.log('Extension successfully pinned to toolbar');
    } else if (pinStatus.attempted === false) {
      console.log('Extension could not be auto-pinned:', pinStatus.error);
    }
  });
  
  setStep(1);
})();
