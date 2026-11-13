// MedPodo - 99% Photo Matcher and Enhanced Date Search Features
// Pure ES module compatible with the existing bundled React application

// 1. Perceptual Image Fingerprinting & 99% Similarity Matching Algorithm
const fpCache = new Map();

/**
 * Computes a 480-bit gradient hash + RGB color distribution of any image.
 * Uses a 16x16 canvas to evaluate horizontal and vertical luminance gradients.
 */
export async function computeImageFingerprint(source) {
  let imgBitmap = null;
  let shouldRevoke = false;
  let tempUrl = '';

  try {
    if (source instanceof Blob || source instanceof File) {
      if (typeof createImageBitmap === 'function') {
        imgBitmap = await createImageBitmap(source);
      } else {
        tempUrl = URL.createObjectURL(source);
        shouldRevoke = true;
        imgBitmap = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = tempUrl;
        });
      }
    } else if (typeof source === 'string') {
      imgBitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = source;
      });
    } else {
      imgBitmap = source;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgBitmap, 0, 0, 16, 16);
    const imgData = ctx.getImageData(0, 0, 16, 16).data;

    // 256 pixel luminance values & color accumulation
    const gray = new Float32Array(256);
    let totalR = 0, totalG = 0, totalB = 0;

    for (let i = 0; i < 256; i++) {
      const idx = i * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      totalR += r;
      totalG += g;
      totalB += b;
    }

    // 480 gradient comparisons:
    // 16 rows * 15 horizontal differences = 240 bits
    // 15 vertical differences * 16 cols = 240 bits
    const bits = new Uint8Array(480);
    let bitIdx = 0;

    // Horizontal gradients
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 15; x++) {
        bits[bitIdx++] = gray[y * 16 + x] < gray[y * 16 + (x + 1)] ? 1 : 0;
      }
    }

    // Vertical gradients
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 16; x++) {
        bits[bitIdx++] = gray[y * 16 + x] < gray[(y + 1) * 16 + x] ? 1 : 0;
      }
    }

    return {
      bits,
      avgR: totalR / 256,
      avgG: totalG / 256,
      avgB: totalB / 256,
    };
  } finally {
    if (imgBitmap && typeof imgBitmap.close === 'function') {
      imgBitmap.close();
    }
    if (shouldRevoke && tempUrl) {
      URL.revokeObjectURL(tempUrl);
    }
  }
}

/**
 * Calculates percentage similarity between two photo fingerprints (0% to 100%).
 * Weight: 85% dHash gradient similarity + 15% color tone similarity.
 */
export function calculateSimilarity(fpA, fpB, metaA = null, metaB = null) {
  if (!fpA || !fpB) return 0;

  // Exact file metadata match check
  if (metaA && metaB && metaA.name === metaB.name && metaA.size && metaB.size && metaA.size === metaB.size) {
    return 100.0;
  }

  // Count different bits in 480-bit gradient hash
  let diffBits = 0;
  for (let i = 0; i < 480; i++) {
    if (fpA.bits[i] !== fpB.bits[i]) diffBits++;
  }

  const bitSimilarity = 1.0 - (diffBits / 480);
  const colorDiff = (Math.abs(fpA.avgR - fpB.avgR) + Math.abs(fpA.avgG - fpB.avgG) + Math.abs(fpA.avgB - fpB.avgB)) / (3 * 255);
  const colorSimilarity = Math.max(0, 1.0 - colorDiff);

  // Identical photos score 100%, near duplicates score 98% - 99.8%
  let score = (bitSimilarity * 0.88 + colorSimilarity * 0.12) * 100;
  if (diffBits <= 2 && colorDiff < 0.04) {
    // Virtually indistinguishable
    score = Math.max(score, 99.2);
  }

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

/**
 * Helper to fetch and fingerprint a photo from Google Drive
 */
async function getDrivePhotoFingerprint(photo, token) {
  if (fpCache.has(photo.id)) {
    return fpCache.get(photo.id);
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(photo.id)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    const fp = await computeImageFingerprint(blob);
    fpCache.set(photo.id, fp);
    return fp;
  } catch (err) {
    console.warn(`Could not fingerprint drive photo ${photo.id}:`, err);
    return null;
  }
}

// 2. React Components
export function createEnhancementComponents(React, jsxRuntime) {
  const { useState, useEffect, useRef, useMemo } = React;
  const { jsx, jsxs, Fragment } = jsxRuntime;

  /**
   * Top Tab Navigation Bar
   */
  function TabBar({ activeTab, onSelectTab, clientCount = 0 }) {
    return jsx('nav', {
      className: 'clinic-nav-tabs',
      'aria-label': 'Main application navigation',
      children: jsxs('div', {
        style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
        children: [
          jsxs('button', {
            className: `clinic-tab-btn ${activeTab === 'clients' ? 'active' : ''}`,
            onClick: () => onSelectTab('clients'),
            children: [
              '📁 Patient Folders',
              clientCount > 0 && jsx('span', { className: 'clinic-tab-badge', children: clientCount }),
            ],
          }),
          jsx('button', {
            className: `clinic-tab-btn ${activeTab === 'dates' ? 'active' : ''}`,
            onClick: () => onSelectTab('dates'),
            children: '📅 Photos by Date',
          }),
          jsxs('button', {
            className: `clinic-tab-btn ${activeTab === 'matcher' ? 'active' : ''}`,
            onClick: () => onSelectTab('matcher'),
            children: [
              '🔍 99% Photo Matcher',
              jsx('span', { className: 'clinic-tab-badge', style: { background: '#10b981', color: '#fff' }, children: 'New' }),
            ],
          }),
        ],
      }),
    });
  }

  /**
   * Return Navigation Banner (shown inside client albums when navigated from search or matcher)
   */
  function ReturnNavBanner({ navOrigin, onReturn }) {
    if (!navOrigin) return null;

    const isMatcher = navOrigin === 'matcher';
    return jsxs('div', {
      className: 'return-nav-banner',
      children: [
        jsxs('button', {
          className: 'return-nav-btn',
          onClick: onReturn,
          children: [
            '← Return to ',
            isMatcher ? 'Photo Matcher' : 'Date Search Results',
          ],
        }),
        jsx('span', {
          className: 'return-nav-text',
          children: isMatcher
            ? 'Jump back to your matching photo comparison'
            : 'Jump back to your searched photos list with dates intact',
        }),
      ],
    });
  }

  /**
   * 99% Photo Matcher Page Component
   */
  function PhotoMatcherPage({ token, clients, onOpenAlbum, Ne, queryDrivePhotos, onConnectDrive }) {
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [referenceFp, setReferenceFp] = useState(null);
    const [scope, setScope] = useState('30days');
    const [customFrom, setCustomFrom] = useState(() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
    });
    const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
    const [matches, setMatches] = useState([]);
    const [minSimilarity, setMinSimilarity] = useState(70);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);
    const cameraInputRef = useRef(null);
    const abortRef = useRef(null);

    // Handle reference file selection
    const handleFile = async (selectedFile) => {
      if (!selectedFile) return;
      setError('');
      setMatches([]);
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);

      try {
        const fp = await computeImageFingerprint(selectedFile);
        setReferenceFp(fp);
      } catch (err) {
        setError('Could not process this image. Please try another photo.');
      }
    };

    // Cleanup object URL
    useEffect(() => {
      return () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      };
    }, [previewUrl]);

    // Start Scanning Google Drive
    const startScan = async () => {
      if (!token || !referenceFp) return;
      setIsScanning(true);
      setError('');
      setMatches([]);
      setProgress({ current: 0, total: 0, status: 'Locating photos in Google Drive…' });

      try {
        let fromDate = customFrom;
        let toDate = customTo;

        if (scope === '30days') {
          const d = new Date();
          d.setDate(d.getDate() - 30);
          fromDate = d.toISOString().split('T')[0];
          toDate = new Date().toISOString().split('T')[0];
        } else if (scope === '90days') {
          const d = new Date();
          d.setDate(d.getDate() - 90);
          fromDate = d.toISOString().split('T')[0];
          toDate = new Date().toISOString().split('T')[0];
        } else if (scope === 'all') {
          fromDate = '2020-01-01';
          toDate = new Date().toISOString().split('T')[0];
        }

        // Query photos from Drive using existing helper
        const candidatePhotos = await queryDrivePhotos(token, clients, fromDate, toDate);
        if (!candidatePhotos || !candidatePhotos.length) {
          setError(`No photos found in Google Drive during the selected period (${fromDate} to ${toDate}).`);
          setIsScanning(false);
          return;
        }

        setProgress({ current: 0, total: candidatePhotos.length, status: `Analyzing ${candidatePhotos.length} photos…` });

        const results = [];
        const batchSize = 4;
        let processed = 0;

        for (let i = 0; i < candidatePhotos.length; i += batchSize) {
          const batch = candidatePhotos.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (item) => {
              const fp = await getDrivePhotoFingerprint(item.photo, token);
              processed++;
              if (fp) {
                const sim = calculateSimilarity(referenceFp, fp, file, item.photo);
                if (sim >= minSimilarity) {
                  results.push({
                    photo: item.photo,
                    client: item.client,
                    path: item.path,
                    similarity: sim,
                  });
                }
              }
              setProgress({
                current: processed,
                total: candidatePhotos.length,
                status: `Comparing photo ${processed} of ${candidatePhotos.length}… (${results.filter(r => r.similarity >= 90).length} high matches found)`,
              });
            })
          );
        }

        // Sort by similarity percentage descending
        results.sort((a, b) => b.similarity - a.similarity);
        setMatches(results);

        if (!results.length) {
          setError(`Scan complete. No photos reached the ${minSimilarity}% similarity threshold.`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred while scanning.');
      } finally {
        setIsScanning(false);
      }
    };

    // Filtered matches
    const displayMatches = useMemo(() => {
      return matches.filter((m) => m.similarity >= minSimilarity);
    }, [matches, minSimilarity]);

    const bestMatch = displayMatches.length > 0 ? displayMatches[0] : null;

    return jsxs('section', {
      className: 'photo-matcher-page',
      children: [
        jsxs('div', {
          className: 'matcher-header',
          children: [
            jsx('p', { className: 'eyebrow', children: 'AI VISUAL SEARCH' }),
            jsx('h1', { children: '99% Photo Matcher' }),
            jsx('p', {
              children:
                'Upload or capture any photo. Our perceptual algorithm analyzes the unique visual signature and finds the 99%+ identical matching photo in your clinic records, locating the client folder and album instantly.',
            }),
          ],
        }),

        // Upload and Preview Grid
        jsxs('div', {
          className: 'matcher-upload-container',
          children: [
            // Drop Zone
            jsxs('div', {
              className: 'matcher-dropzone',
              onClick: () => fileInputRef.current?.click(),
              onDragOver: (e) => {
                e.preventDefault();
                e.currentTarget.classList.add('dragover');
              },
              onDragLeave: (e) => {
                e.currentTarget.classList.remove('dragover');
              },
              onDrop: (e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('dragover');
                if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
              },
              children: [
                jsx('div', { className: 'matcher-dropzone-icon', children: '📷' }),
                jsx('h3', { children: file ? 'Click to Change Photo' : 'Upload Reference Photo' }),
                jsx('p', { children: 'Drag & drop image here, or choose an option below:' }),
                jsxs('div', {
                  className: 'matcher-buttons-row',
                  onClick: (e) => e.stopPropagation(),
                  children: [
                    jsx('button', {
                      className: 'matcher-btn-pick',
                      type: 'button',
                      onClick: () => fileInputRef.current?.click(),
                      children: 'Choose File',
                    }),
                    jsx('button', {
                      className: 'matcher-btn-camera',
                      type: 'button',
                      onClick: () => cameraInputRef.current?.click(),
                      children: '📸 Take Photo',
                    }),
                  ],
                }),
                jsx('input', {
                  ref: fileInputRef,
                  type: 'file',
                  accept: 'image/*',
                  hidden: true,
                  onChange: (e) => e.target.files?.[0] && handleFile(e.target.files[0]),
                }),
                jsx('input', {
                  ref: cameraInputRef,
                  type: 'file',
                  accept: 'image/*',
                  capture: 'environment',
                  hidden: true,
                  onChange: (e) => e.target.files?.[0] && handleFile(e.target.files[0]),
                }),
              ],
            }),

            // Reference Preview Box
            jsxs('div', {
              className: 'matcher-preview-box',
              children: [
                jsxs('h4', {
                  children: [
                    'Reference Image to Match',
                    file && jsx('span', { style: { fontSize: '11px', color: '#10b981', fontWeight: '800' }, children: '✓ Ready' }),
                  ],
                }),
                jsx('div', {
                  className: 'matcher-preview-img-wrap',
                  children: previewUrl
                    ? jsx('img', { src: previewUrl, alt: 'Reference photo preview' })
                    : jsx('span', { style: { color: '#94a3b8', fontSize: '13px' }, children: 'No photo selected yet' }),
                }),
                file &&
                  jsxs('div', {
                    className: 'matcher-preview-meta',
                    children: [
                      jsx('span', { children: file.name }),
                      jsx('span', { children: `${(file.size / 1024).toFixed(1)} KB` }),
                    ],
                  }),
              ],
            }),
          ],
        }),

        // Scan Controls
        jsxs('div', {
          className: 'matcher-controls',
          children: [
            jsxs('div', {
              className: 'matcher-controls-grid',
              children: [
                jsxs('label', {
                  children: [
                    'Search Scope:',
                    jsxs('select', {
                      value: scope,
                      onChange: (e) => setScope(e.target.value),
                      disabled: isScanning,
                      children: [
                        jsx('option', { value: '30days', children: 'Last 30 Days (Fastest)' }),
                        jsx('option', { value: '90days', children: 'Last 90 Days' }),
                        jsx('option', { value: 'all', children: 'All Records (Comprehensive)' }),
                        jsx('option', { value: 'custom', children: 'Custom Date Range…' }),
                      ],
                    }),
                  ],
                }),

                scope === 'custom' &&
                  jsxs('label', {
                    children: [
                      'From Date:',
                      jsx('input', {
                        type: 'date',
                        value: customFrom,
                        onChange: (e) => setCustomFrom(e.target.value),
                        disabled: isScanning,
                      }),
                    ],
                  }),

                scope === 'custom' &&
                  jsxs('label', {
                    children: [
                      'To Date:',
                      jsx('input', {
                        type: 'date',
                        value: customTo,
                        onChange: (e) => setCustomTo(e.target.value),
                        disabled: isScanning,
                      }),
                    ],
                  }),

                jsxs('label', {
                  children: [
                    `Min Similarity: ${minSimilarity}%`,
                    jsx('input', {
                      type: 'range',
                      min: 50,
                      max: 99,
                      step: 1,
                      value: minSimilarity,
                      onChange: (e) => setMinSimilarity(Number(e.target.value)),
                      disabled: isScanning,
                    }),
                  ],
                }),

                !token
                  ? jsx('button', {
                      className: 'matcher-start-btn',
                      type: 'button',
                      onClick: onConnectDrive,
                      children: '🔑 Connect Google Drive to Scan Photos',
                    })
                  : jsx('button', {
                      className: 'matcher-start-btn',
                      type: 'button',
                      disabled: !file || isScanning,
                      onClick: startScan,
                      children: isScanning ? '🔍 Scanning Drive Photos…' : 'Start 99% Match Scan',
                    }),
              ],
            }),
          ],
        }),

        // Error message
        error && jsx('p', { className: 'message error', role: 'alert', children: error }),

        // Progress Section
        isScanning &&
          jsxs('div', {
            className: 'matcher-progress-box',
            children: [
              jsxs('div', {
                style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '700', color: '#1e293b' },
                children: [
                  jsx('span', { children: progress.status }),
                  progress.total > 0 &&
                    jsx('span', {
                      children: `${Math.round((progress.current / progress.total) * 100)}%`,
                    }),
                ],
              }),
              jsx('div', {
                className: 'matcher-progress-bar-bg',
                children: jsx('div', {
                  className: 'matcher-progress-bar-fill',
                  style: {
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                  },
                }),
              }),
            ],
          }),

        // Best Match Announcement Banner
        !isScanning &&
          bestMatch &&
          bestMatch.similarity >= 95 &&
          jsxs('div', {
            style: {
              background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
              border: '2px solid #10b981',
              borderRadius: '16px',
              padding: '16px 20px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap',
            },
            children: [
              jsxs('div', {
                children: [
                  jsxs('span', {
                    style: {
                      background: '#10b981',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: '800',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      display: 'inline-block',
                      marginBottom: '6px',
                    },
                    children: [`🎉 ${bestMatch.similarity}% MATCH FOUND`],
                  }),
                  jsx('h3', {
                    style: { margin: '2px 0 4px', fontSize: '17px', color: '#064e3b' },
                    children: `Identified Client: ${bestMatch.client.name}`,
                  }),
                  jsx('p', {
                    style: { margin: 0, fontSize: '13px', color: '#047857' },
                    children: `Located in folder: ${bestMatch.path.map((p) => p.name).join(' / ')}`,
                  }),
                ],
              }),
              jsx('button', {
                className: 'match-jump-btn',
                style: { width: 'auto', padding: '10px 20px' },
                onClick: () => onOpenAlbum(bestMatch.path),
                children: 'Open This Album Now →',
              }),
            ],
          }),

        // Results Section
        !isScanning &&
          displayMatches.length > 0 &&
          jsxs('div', {
            children: [
              jsxs('div', {
                className: 'matcher-results-heading',
                children: [
                  jsxs('h2', { children: ['Found Matches (', displayMatches.length, ')'] }),
                  jsx('span', {
                    style: { fontSize: '13px', color: '#64748b' },
                    children: 'Ranked from highest similarity to lowest',
                  }),
                ],
              }),
              jsx('div', {
                className: 'matcher-results-grid',
                children: displayMatches.map((item) => {
                  const is99 = item.similarity >= 98;
                  const is90 = item.similarity >= 90;
                  const badgeClass = is99 ? 'badge-99' : is90 ? 'badge-90' : 'badge-low';
                  const badgeText = is99 ? `✨ ${item.similarity}% Exact Match` : `${item.similarity}% Match`;

                  return jsxs(
                    'div',
                    {
                      className: `match-card ${is99 ? 'exact-match' : ''}`,
                      children: [
                        jsxs('div', {
                          className: 'match-card-header',
                          children: [
                            jsx('span', { className: `match-badge ${badgeClass}`, children: badgeText }),
                            jsx('span', {
                              style: { fontSize: '11px', color: '#64748b' },
                              children: item.photo.createdTime ? new Date(item.photo.createdTime).toLocaleDateString() : '',
                            }),
                          ],
                        }),
                        jsxs('div', {
                          className: 'match-comparison-view',
                          children: [
                            jsxs('div', {
                              className: 'match-thumb-box',
                              children: [
                                jsx('img', { src: previewUrl, alt: 'Your Upload' }),
                                jsx('span', { children: 'Your Upload' }),
                              ],
                            }),
                            jsxs('div', {
                              className: 'match-thumb-box',
                              children: [
                                jsx(Ne, { token, photo: item.photo, alt: item.photo.name }),
                                jsx('span', { children: 'Drive Match' }),
                              ],
                            }),
                          ],
                        }),
                        jsxs('div', {
                          className: 'match-card-body',
                          children: [
                            jsxs('span', {
                              className: 'match-client-name',
                              children: ['👤 ', item.client.name],
                            }),
                            jsxs('span', {
                              className: 'match-album-name',
                              children: [
                                '📁 ',
                                item.path.length > 1
                                  ? item.path.slice(1).map((p) => p.name).join(' / ')
                                  : 'Main photos',
                              ],
                            }),
                            item.photo.createdTime &&
                              jsx('span', {
                                className: 'match-photo-date',
                                children: `Added: ${new Date(item.photo.createdTime).toLocaleString()}`,
                              }),
                          ],
                        }),
                        jsx('div', {
                          className: 'match-card-footer',
                          children: jsx('button', {
                            className: 'match-jump-btn',
                            onClick: () => onOpenAlbum(item.path),
                            children: 'Jump to Album →',
                          }),
                        }),
                      ],
                    },
                    item.photo.id
                  );
                }),
              }),
            ],
          }),
      ],
    });
  }

  return { TabBar, ReturnNavBanner, PhotoMatcherPage };
}
