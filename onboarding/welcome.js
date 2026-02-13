(() => {
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnboarding);
  } else {
    // Add a small delay to ensure DOM is fully processed
    setTimeout(initOnboarding, 100);
  }
  
  function initOnboarding() {
    const stepsEl = document.getElementById('steps');
    const progressEl = document.getElementById('progress');
    const openAmazonBtn = document.getElementById('openAmazon');
    const startShoppingBtn = document.getElementById('startShopping');
    const howItWorksStep = document.getElementById('howItWorksStep');
    const finishStep = stepsEl ? stepsEl.querySelector('.step[data-step="7"]') : null;
    const trustStep = stepsEl ? stepsEl.querySelector('.step[data-step="4"]') : null;
    const trustControlStep = document.getElementById('trustControlStep');
    const trustToggleBtn = trustControlStep
      ? trustControlStep.querySelector('[data-role="alt-toggle"]')
      : null;

  // Check if extension was successfully pinned
  const checkPinStatus = async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(['hasAttemptedPin', 'pinError']);
        return {
          attempted: result.hasAttemptedPin,
          error: result.pinError
        };
      } else {
        // Chrome storage not available in onboarding context
        return { attempted: null, error: 'Chrome storage not available' };
      }
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

  if (!stepsEl || !progressEl) {
    console.error('Critical elements not found!');
    return;
  }

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
      }, 2000);
    }, 1500);
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

  // Pin animation functions (must be before setStep)
  let pinAnimationTimer = null;
  const pinEls = {
    puzzle:   document.getElementById('pinDemoPuzzle'),
    cursor:   document.getElementById('pinDemoCursor'),
    dropdown: document.getElementById('pinDemoDropdown'),
    ffRow:    document.getElementById('pinDemoFairFindz'),
    pinBtn:   document.getElementById('pinDemoPinBtn'),
    pinned:   document.getElementById('pinDemoPinned'),
    label:    document.getElementById('pinDemoLabel'),
  };

  function resetPinDemo() {
    if (!pinEls.puzzle) return;
    pinEls.puzzle.classList.remove('is-highlight');
    pinEls.cursor.style.opacity = '0';
    pinEls.dropdown.classList.remove('is-visible');
    pinEls.ffRow.classList.remove('is-highlight');
    pinEls.pinBtn.classList.remove('is-active');
    pinEls.pinned.classList.remove('is-visible');
    pinEls.label.classList.remove('is-visible');
    pinEls.label.textContent = '';
  }

  function startPinAnimation() {
    if (!pinEls.puzzle) return;
    stopPinAnimation();
    resetPinDemo();

    const run = () => {
      resetPinDemo();

      // 1 – Cursor appears and moves toward puzzle icon
      pinEls.cursor.style.top = '60px';
      pinEls.cursor.style.left = '80%';
      pinEls.cursor.style.opacity = '1';
      pinEls.label.textContent = 'Click the puzzle piece icon';
      pinEls.label.classList.add('is-visible');

      setTimeout(() => {
        // Move cursor to puzzle icon
        pinEls.cursor.style.top = '6px';
        pinEls.cursor.style.left = 'calc(100% - 40px)';
      }, 200);

      setTimeout(() => {
        // 2 – Click puzzle → highlight it, open dropdown
        pinEls.puzzle.classList.add('is-highlight');
        pinEls.dropdown.classList.add('is-visible');
        pinEls.label.textContent = 'Find FairFindz in the list';
      }, 900);

      setTimeout(() => {
        // 3 – Cursor moves to FairFindz row
        pinEls.cursor.style.top = '80px';
        pinEls.cursor.style.left = 'calc(100% - 50px)';
        pinEls.ffRow.classList.add('is-highlight');
      }, 1600);

      setTimeout(() => {
        // 4 – Cursor moves to pin button, clicks it
        pinEls.cursor.style.top = '78px';
        pinEls.cursor.style.left = 'calc(100% - 30px)';
        pinEls.label.textContent = 'Click the pin icon';
      }, 2200);

      setTimeout(() => {
        // 5 – Pin activates
        pinEls.pinBtn.classList.add('is-active');
      }, 2700);

      setTimeout(() => {
        // 6 – Dropdown closes, pinned icon appears in toolbar
        pinEls.dropdown.classList.remove('is-visible');
        pinEls.puzzle.classList.remove('is-highlight');
        pinEls.cursor.style.opacity = '0';
        pinEls.pinned.classList.add('is-visible');
        pinEls.label.textContent = 'FairFindz is now pinned!';
      }, 3200);

      setTimeout(() => {
        // 7 – Hold the final state, then loop
        pinAnimationTimer = setTimeout(run, 1200);
      }, 5500);
    };

    // Kick off after a short pause
    pinAnimationTimer = setTimeout(run, 400);
  }

  function stopPinAnimation() {
    if (pinAnimationTimer) {
      clearTimeout(pinAnimationTimer);
      pinAnimationTimer = null;
    }
    resetPinDemo();
  }

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
      if (current === 7) { // Updated from 6 to 7
        window.requestAnimationFrame(() => {
          finishStep.classList.add('is-fx');
        });
      }
    }

    // Pin step animation
    if (current === 6) {
      startPinAnimation();
    } else {
      stopPinAnimation();
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

  } // End of initOnboarding function
})(); // End of IIFE
