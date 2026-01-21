/**
 * Admin Dashboard JavaScript
 */

// ============================================================================
// Authentication
// ============================================================================
function getToken() {
    return sessionStorage.getItem('adminToken');
}

function checkAuth() {
    if (!getToken()) {
        window.location.href = '/admin/login';
        return false;
    }
    return true;
}

function logout() {
    sessionStorage.removeItem('adminToken');
    window.location.href = '/admin/login';
}

async function apiCall(endpoint, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers
    };

    const response = await fetch(endpoint, { ...options, headers });

    if (response.status === 401) {
        logout();
        return null;
    }

    return response;
}

// ============================================================================
// Navigation
// ============================================================================
function showPage(pageName, updateHash = true) {
    // Update URL hash to preserve state on refresh
    if (updateHash && window.location.hash !== `#${pageName}`) {
        window.location.hash = pageName;
    }

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageName);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `${pageName}Page`);
    });

    // Update title
    const titles = {
        dashboard: 'Dashboard',
        products: 'Products',
        content: 'Content Manager',
        users: 'Users',
        analytics: 'Analytics',
        settings: 'Settings'
    };
    document.getElementById('pageTitle').textContent = titles[pageName] || pageName;

    // Load page data
    switch (pageName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'products':
            loadProducts();
            break;
        case 'content':
            loadContent();
            break;
        case 'users':
            loadUsers();
            break;
        case 'analytics':
            loadAnalytics();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// Get the initial page from URL hash
function getPageFromHash() {
    const hash = window.location.hash.slice(1); // Remove the # symbol
    const validPages = ['dashboard', 'products', 'content', 'users', 'analytics', 'settings'];
    return validPages.includes(hash) ? hash : 'dashboard';
}

// ============================================================================
// Dashboard
// ============================================================================
async function loadDashboard() {
    try {
        const response = await apiCall('/admin/api/analytics/summary');
        if (!response) return;

        const data = await response.json();

        document.getElementById('totalUsers').textContent = data.total_users || 0;
        document.getElementById('totalChats').textContent = data.total_chats || 0;
        document.getElementById('usersToday').textContent = data.users_today || 0;
        document.getElementById('presentationStarts').textContent = data.presentation_starts || 0;

        // Load recent activity
        loadRecentActivity();
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function loadRecentActivity() {
    try {
        const response = await apiCall('/admin/api/analytics/recent');
        if (!response) return;

        const events = await response.json();
        const activityList = document.getElementById('recentActivity');

        if (events.length === 0) {
            activityList.innerHTML = '<li class="text-muted">No recent activity</li>';
            return;
        }

        activityList.innerHTML = events.slice(0, 10).map(event => {
            const icons = {
                'user_registered': 'fa-user-plus',
                'chat_message': 'fa-comment',
                'presentation_start': 'fa-play',
                'presentation_complete': 'fa-check'
            };
            const icon = icons[event.event_type] || 'fa-circle';
            const time = formatTime(event.timestamp);

            return `
                <li>
                    <div class="activity-icon"><i class="fas ${icon}"></i></div>
                    <span>${event.user_name || 'Anonymous'} - ${event.event_type.replace('_', ' ')}</span>
                    <span class="activity-time">${time}</span>
                </li>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading activity:', error);
    }
}

// ============================================================================
// Products
// ============================================================================
let allProducts = [];
let selectedProductId = null;

async function loadProducts() {
    try {
        const response = await apiCall('/admin/api/products');
        if (!response) return;

        allProducts = await response.json();
        renderProducts(allProducts);
        populateProductDropdowns();
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

async function renderProducts(products) {
    const grid = document.getElementById('productsGrid');

    if (products.length === 0) {
        grid.innerHTML = `
            <div class="no-products">
                <i class="fas fa-box-open"></i>
                <p>No products yet. Click "Add Product" to create one.</p>
            </div>
        `;
        return;
    }

    // Check PDF and JSON status for each product
    const productCards = await Promise.all(products.map(async (product) => {
        let pdfStatus = { exists: false };
        let hasJson = false;

        try {
            const pdfResponse = await apiCall(`/admin/api/products/${product.id}/pdf-info`);
            if (pdfResponse && pdfResponse.ok) {
                pdfStatus = await pdfResponse.json();
            }

            const jsonResponse = await apiCall(`/admin/api/products/${product.id}/json/presentation`);
            hasJson = jsonResponse && jsonResponse.ok;
        } catch (e) {
            console.log('Error checking product status:', e);
        }

        const needsProcessing = pdfStatus.exists && !hasJson;
        const processingState = product.id in (window.productProcessingStates || {})
            ? window.productProcessingStates[product.id]
            : null;

        let statusBadge = `<span class="product-status ${product.status}">${product.status}</span>`;
        let processBtn = '';

        if (needsProcessing) {
            statusBadge = `<span class="product-status warning">Needs Processing</span>`;
            processBtn = `
                <button class="process-btn" onclick="processProduct(${product.id})">
                    <i class="fas fa-cog"></i> Process PDF
                </button>
            `;
        } else if (hasJson) {
            statusBadge = `<span class="product-status active">Ready</span>`;
        } else if (!pdfStatus.exists) {
            statusBadge = `<span class="product-status inactive">No PDF</span>`;
        }

        return `
            <div class="product-card" id="product-card-${product.id}">
                <div class="product-icon">
                    <i class="fas fa-box"></i>
                </div>
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-slug">/${product.slug}</div>
                    ${statusBadge}
                    <div class="product-actions">
                        ${processBtn}
                        <button class="edit-btn" onclick="editProduct(${product.id})">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="delete-btn" onclick="deleteProduct(${product.id})">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>
        `;
    }));

    grid.innerHTML = productCards.join('');
}

// Process PDF for a product
async function processProduct(productId) {
    const card = document.getElementById(`product-card-${productId}`);
    const statusSpan = card.querySelector('.product-status');
    const processBtn = card.querySelector('.process-btn');

    if (processBtn) {
        processBtn.disabled = true;
        processBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }
    statusSpan.textContent = 'Processing...';
    statusSpan.className = 'product-status warning';

    // Show processing modal
    showProcessingModal();

    try {
        const response = await apiCall(`/admin/api/products/${productId}/process`, {
            method: 'POST'
        });

        if (!response || !response.ok) {
            throw new Error('Failed to start processing');
        }

        // Poll for status
        pollProcessingStatus(productId);

    } catch (error) {
        console.error('Processing error:', error);
        showProcessingError(error.message);
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.innerHTML = '<i class="fas fa-cog"></i> Process PDF';
        }
    }
}

// Processing Modal Functions
function showProcessingModal() {
    const modal = document.getElementById('processingModal');
    const progressFill = document.getElementById('processingProgressFill');
    const stage = document.getElementById('processingStage');
    const result = document.getElementById('processingResult');
    const icon = modal.querySelector('.processing-icon i');

    modal.style.display = 'flex';
    progressFill.style.width = '0%';
    stage.textContent = 'Initializing...';
    result.style.display = 'none';
    icon.className = 'fas fa-cog fa-spin';
    modal.querySelector('.processing-icon').style.background = 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)';
}

function updateProcessingProgress(progress, stageText) {
    const progressFill = document.getElementById('processingProgressFill');
    const stage = document.getElementById('processingStage');

    progressFill.style.width = `${progress}%`;
    stage.textContent = stageText;
}

function showProcessingSuccess() {
    const modal = document.getElementById('processingModal');
    const result = document.getElementById('processingResult');
    const icon = modal.querySelector('.processing-icon i');
    const progressDiv = modal.querySelector('.processing-progress');

    icon.className = 'fas fa-check';
    icon.style.animation = 'none';
    modal.querySelector('.processing-icon').style.background = 'linear-gradient(135deg, var(--success) 0%, #059669 100%)';
    modal.querySelector('h3').textContent = 'Processing Complete!';
    modal.querySelector('.processing-content > p').textContent = 'Your presentation is ready.';
    progressDiv.style.display = 'none';

    result.innerHTML = `
        <i class="fas fa-check-circle success-icon"></i>
        <p>The presentation and analysis files have been created successfully.</p>
        <button onclick="closeProcessingModal()" class="btn btn-primary">Done</button>
    `;
    result.style.display = 'block';
}

function showProcessingError(message) {
    const modal = document.getElementById('processingModal');
    const result = document.getElementById('processingResult');
    const icon = modal.querySelector('.processing-icon i');
    const progressDiv = modal.querySelector('.processing-progress');

    icon.className = 'fas fa-times';
    icon.style.animation = 'none';
    modal.querySelector('.processing-icon').style.background = 'linear-gradient(135deg, var(--error) 0%, #dc2626 100%)';
    modal.querySelector('h3').textContent = 'Processing Failed';
    modal.querySelector('.processing-content > p').textContent = 'An error occurred during processing.';
    progressDiv.style.display = 'none';

    result.innerHTML = `
        <i class="fas fa-exclamation-circle error-icon" style="color: var(--error);"></i>
        <p>${message || 'Unknown error occurred'}</p>
        <button onclick="closeProcessingModal()" class="btn btn-primary">Close</button>
    `;
    result.style.display = 'block';
}

function closeProcessingModal() {
    document.getElementById('processingModal').style.display = 'none';
    loadProducts(); // Refresh the product list
}

// Poll processing status
async function pollProcessingStatus(productId) {
    const card = document.getElementById(`product-card-${productId}`);
    const statusSpan = card?.querySelector('.product-status');
    const processBtn = card?.querySelector('.process-btn');

    try {
        const response = await apiCall(`/admin/api/products/${productId}/status`);
        if (!response) return;

        const status = await response.json();

        if (status.stage === 'complete') {
            if (statusSpan) {
                statusSpan.textContent = 'Ready';
                statusSpan.className = 'product-status active';
            }
            if (processBtn) {
                processBtn.remove();
            }
            updateProcessingProgress(100, 'Complete!');
            setTimeout(showProcessingSuccess, 500);
        } else if (status.stage === 'error') {
            if (statusSpan) {
                statusSpan.textContent = 'Error';
                statusSpan.className = 'product-status error';
            }
            if (processBtn) {
                processBtn.disabled = false;
                processBtn.innerHTML = '<i class="fas fa-cog"></i> Retry';
            }
            showProcessingError(status.message || 'Processing failed');
        } else {
            // Still processing, update progress and poll again
            const progress = status.progress || 0;
            let stageText = 'Processing...';

            if (status.stage === 'analyzing') {
                stageText = `Analyzing PDF pages... ${progress}%`;
            } else if (status.stage === 'generating') {
                stageText = `Generating presentation... ${progress}%`;
            } else if (status.stage === 'extracting') {
                stageText = `Extracting images... ${progress}%`;
            }

            updateProcessingProgress(progress, stageText);

            if (statusSpan) {
                statusSpan.textContent = `Processing... ${progress}%`;
            }
            setTimeout(() => pollProcessingStatus(productId), 2000);
        }
    } catch (error) {
        console.error('Status poll error:', error);
    }
}

function populateProductDropdowns() {
    const contentSelect = document.getElementById('contentProductSelect');
    if (contentSelect) {
        contentSelect.innerHTML = '<option value="">-- Select a product --</option>' +
            allProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }
}

function showAddProductModal() {
    document.getElementById('addProductModal').style.display = 'flex';
    document.getElementById('productName').value = '';
    document.getElementById('productSlug').value = '';
    document.getElementById('productDescription').value = '';
    document.getElementById('selectedFileName').textContent = '';
    document.getElementById('productUploadProgress').style.display = 'none';
}

function closeAddProductModal() {
    document.getElementById('addProductModal').style.display = 'none';
}

function initProducts() {
    const uploadZone = document.getElementById('productUploadZone');
    const pdfInput = document.getElementById('productPdfInput');
    const nameInput = document.getElementById('productName');
    const slugInput = document.getElementById('productSlug');

    if (uploadZone && pdfInput) {
        uploadZone.addEventListener('click', () => pdfInput.click());
        pdfInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                document.getElementById('selectedFileName').textContent = e.target.files[0].name;
            }
        });
    }

    // Auto-generate slug from name
    if (nameInput && slugInput) {
        nameInput.addEventListener('input', () => {
            slugInput.value = nameInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        });
    }

    // Form submit
    const form = document.getElementById('addProductForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createProduct();
        });
    }
}

async function createProduct() {
    const name = document.getElementById('productName').value;
    const slug = document.getElementById('productSlug').value;
    const description = document.getElementById('productDescription').value;
    const pdfFile = document.getElementById('productPdfInput').files[0];

    if (!name || !slug) {
        alert('Please enter product name and slug');
        return;
    }

    const progressDiv = document.getElementById('productUploadProgress');
    const progressFill = document.getElementById('productProgressFill');
    const statusText = document.getElementById('productUploadStatus');

    progressDiv.style.display = 'block';
    statusText.textContent = 'Creating product...';
    progressFill.style.width = '10%';

    try {
        // Create product in database
        const createResponse = await apiCall('/admin/api/products', {
            method: 'POST',
            body: JSON.stringify({ name, slug, description })
        });

        if (!createResponse || !createResponse.ok) {
            throw new Error('Failed to create product');
        }

        const productData = await createResponse.json();
        const productId = productData.id;

        progressFill.style.width = '30%';

        // Upload PDF if provided
        if (pdfFile) {
            statusText.textContent = 'Uploading PDF...';
            const formData = new FormData();
            formData.append('file', pdfFile);

            const uploadResponse = await fetch(`/admin/api/products/${productId}/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${getToken()}` },
                body: formData
            });

            if (!uploadResponse.ok) {
                throw new Error('Failed to upload PDF');
            }

            // Poll for processing status
            statusText.textContent = 'Processing PDF...';
            progressFill.style.width = '50%';

            let processing = true;
            while (processing) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                const statusResponse = await apiCall(`/admin/api/products/${productId}/status`);
                const status = await statusResponse.json();

                if (status.stage === 'complete') {
                    processing = false;
                    progressFill.style.width = '100%';
                } else if (status.stage === 'error') {
                    throw new Error(status.message || 'Processing failed');
                } else {
                    progressFill.style.width = `${50 + Math.min(status.progress || 0, 45)}%`;
                }
            }
        }

        statusText.textContent = 'Product created successfully!';
        setTimeout(() => {
            closeAddProductModal();
            loadProducts();
        }, 1000);

    } catch (error) {
        console.error('Error creating product:', error);
        statusText.textContent = `Error: ${error.message}`;
        progressFill.style.background = 'var(--error)';
    }
}

async function deleteProduct(productId) {
    if (!confirm('Delete this product and all its data?')) return;

    try {
        const response = await apiCall(`/admin/api/products/${productId}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            loadProducts();
        }
    } catch (error) {
        alert('Error deleting product');
    }
}

function editProduct(productId) {
    // For now, just go to content manager with this product selected
    selectedProductId = productId;
    showPage('content');
    setTimeout(() => {
        document.getElementById('contentProductSelect').value = productId;
        loadProductContent();
    }, 100);
}

// ============================================================================
// Product Content Loading
// ============================================================================
async function loadProductContent() {
    const productId = document.getElementById('contentProductSelect')?.value;
    selectedProductId = productId ? parseInt(productId) : null;

    if (!selectedProductId) {
        document.getElementById('presentationJSON').value = 'Select a product to view its content';
        document.getElementById('analysisJSON').value = 'Select a product to view its content';
        document.getElementById('imagesGrid').innerHTML = '<p class="text-muted">Select a product to view images</p>';
        document.getElementById('imageCount').textContent = '0 images';
        document.getElementById('pdfInfo').innerHTML = '<p class="text-muted">Select a product to view its PDF</p>';
        document.getElementById('pdfViewer').innerHTML = '';
        return;
    }

    // Load PDF, JSON and images for selected product
    loadProductPDF();
    loadProductJSON('presentation');
    loadProductJSON('analysis');
    loadProductImages();
}

async function loadProductPDF() {
    if (!selectedProductId) return;

    const pdfInfo = document.getElementById('pdfInfo');
    const pdfViewer = document.getElementById('pdfViewer');
    const pdfUploadSection = document.getElementById('pdfUploadSection');

    try {
        const response = await apiCall(`/admin/api/products/${selectedProductId}/pdf-info`);
        if (!response) return;

        const data = await response.json();

        if (data.exists) {
            const sizeKB = Math.round(data.size / 1024);
            const sizeMB = (data.size / (1024 * 1024)).toFixed(2);
            const sizeDisplay = sizeKB > 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

            pdfInfo.innerHTML = `
                <div class="pdf-details">
                    <span class="pdf-name">
                        <i class="fas fa-file-pdf"></i>
                        ${data.filename}
                    </span>
                    <span class="pdf-size">${sizeDisplay}</span>
                </div>
                <div class="pdf-actions">
                    <button class="open-btn" onclick="window.open('${data.url}', '_blank')">
                        <i class="fas fa-external-link-alt"></i> Open in New Tab
                    </button>
                    <a href="${data.url}" download class="download-btn" style="text-decoration: none;">
                        <i class="fas fa-download"></i> Download
                    </a>
                </div>
            `;

            pdfViewer.innerHTML = `<iframe src="${data.url}#toolbar=1&navpanes=0" title="PDF Viewer"></iframe>`;
            pdfViewer.style.display = 'block';
            if (pdfUploadSection) pdfUploadSection.style.display = 'none';
        } else {
            pdfInfo.innerHTML = '<p class="text-muted">No PDF uploaded for this product. Upload one below:</p>';
            pdfViewer.style.display = 'none';
            if (pdfUploadSection) {
                pdfUploadSection.style.display = 'block';
                initContentPdfUpload();
            }
        }
    } catch (error) {
        console.error('Error loading PDF info:', error);
        pdfInfo.innerHTML = '<p class="text-muted">Error loading PDF info</p>';
    }
}

// Initialize PDF upload in Content Manager
function initContentPdfUpload() {
    const uploadZone = document.getElementById('contentPdfUploadZone');
    const fileInput = document.getElementById('contentPdfInput');

    if (!uploadZone || !fileInput) return;

    // Remove existing listeners by cloning
    const newUploadZone = uploadZone.cloneNode(true);
    uploadZone.parentNode.replaceChild(newUploadZone, uploadZone);

    const newFileInput = newUploadZone.querySelector('input[type="file"]');

    newUploadZone.addEventListener('click', () => newFileInput.click());
    newUploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        newUploadZone.classList.add('dragover');
    });
    newUploadZone.addEventListener('dragleave', () => {
        newUploadZone.classList.remove('dragover');
    });
    newUploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        newUploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleContentPdfUpload(e.dataTransfer.files[0]);
        }
    });
    newFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleContentPdfUpload(e.target.files[0]);
        }
    });
}

// Handle PDF upload from Content Manager
async function handleContentPdfUpload(file) {
    if (!selectedProductId) {
        alert('Please select a product first');
        return;
    }

    if (!file.name.endsWith('.pdf')) {
        alert('Please select a PDF file');
        return;
    }

    const progressDiv = document.getElementById('contentUploadProgress');
    const progressFill = document.getElementById('contentProgressFill');
    const statusText = document.getElementById('contentUploadStatus');

    progressDiv.style.display = 'block';
    statusText.textContent = 'Uploading PDF...';
    progressFill.style.width = '20%';
    progressFill.style.background = 'var(--primary)';

    try {
        const formData = new FormData();
        formData.append('file', file);

        const uploadResponse = await fetch(`/admin/api/products/${selectedProductId}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });

        if (!uploadResponse.ok) {
            const error = await uploadResponse.json();
            throw new Error(error.detail || 'Upload failed');
        }

        progressFill.style.width = '50%';
        statusText.textContent = 'Processing PDF... This may take a few minutes.';

        // Poll for processing status
        let processing = true;
        while (processing) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const statusResponse = await apiCall(`/admin/api/products/${selectedProductId}/status`);
            const status = await statusResponse.json();

            if (status.stage === 'complete') {
                processing = false;
                progressFill.style.width = '100%';
                statusText.textContent = 'Processing complete!';
            } else if (status.stage === 'error') {
                throw new Error(status.message || 'Processing failed');
            } else {
                const progress = 50 + Math.min(status.progress || 0, 45);
                progressFill.style.width = `${progress}%`;
                statusText.textContent = `Processing... ${status.message || ''}`;
            }
        }

        // Reload content after a short delay
        setTimeout(() => {
            progressDiv.style.display = 'none';
            loadProductContent();
            loadProducts();
        }, 1500);

    } catch (error) {
        console.error('Upload error:', error);
        statusText.textContent = `Error: ${error.message}`;
        progressFill.style.background = 'var(--error)';
    }
}

async function loadProductJSON(type) {
    if (!selectedProductId) return;

    const textarea = document.getElementById(`${type}JSON`);
    try {
        const response = await apiCall(`/admin/api/products/${selectedProductId}/json/${type}`);
        if (!response) return;

        if (response.ok) {
            const data = await response.json();
            textarea.value = JSON.stringify(data, null, 2);
        } else {
            const error = await response.json();
            textarea.value = `No ${type}.json found. Upload and process a PDF first.`;
        }
    } catch (error) {
        console.error(`Error loading ${type} JSON:`, error);
        textarea.value = `Error loading ${type}.json`;
    }
}

async function loadProductImages() {
    if (!selectedProductId) return;

    try {
        const showDeleted = document.getElementById('showDeleted')?.checked || false;
        const response = await apiCall(`/admin/api/products/${selectedProductId}/images?show_deleted=${showDeleted}`);
        if (!response) return;

        const images = await response.json();
        const grid = document.getElementById('imagesGrid');
        const count = document.getElementById('imageCount');

        count.textContent = `${images.length} images`;

        if (images.length === 0) {
            grid.innerHTML = '<p class="text-muted">No images found. Upload and process a PDF first.</p>';
            return;
        }

        grid.innerHTML = images.map(img => `
            <div class="image-card ${img.is_deleted ? 'deleted' : ''}">
                <img src="/products/${selectedProductId}/images/${img.filename}" alt="${img.filename}"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%231a1a2e%22 width=%22200%22 height=%22150%22/><text fill=%22%2394a3b8%22 x=%22100%22 y=%2275%22 text-anchor=%22middle%22>No preview</text></svg>'">
                <div class="image-info">
                    <p class="image-path">${img.filename}</p>
                    <div class="image-actions">
                        ${img.is_deleted
                            ? `<button class="restore-btn" onclick="restoreProductImage('${img.path}')">
                                 <i class="fas fa-undo"></i> Restore
                               </button>`
                            : `<button class="delete-btn" onclick="deleteProductImage('${img.path}')">
                                 <i class="fas fa-trash"></i> Delete
                               </button>`
                        }
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading images:', error);
    }
}

async function saveProductJSON(type) {
    if (!selectedProductId) {
        alert('Please select a product first');
        return;
    }

    const textarea = document.getElementById(`${type}JSON`);

    try {
        const data = JSON.parse(textarea.value);

        const response = await apiCall(`/admin/api/products/${selectedProductId}/json/${type}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        if (response && response.ok) {
            alert(`${type}.json saved successfully!`);
        } else {
            throw new Error('Save failed');
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

async function deleteProductImage(path) {
    if (!confirm('Delete this image? It will be hidden from the frontend.')) return;

    try {
        const response = await apiCall(`/admin/api/images/${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            loadProductImages();
        }
    } catch (error) {
        alert('Error deleting image');
    }
}

async function restoreProductImage(path) {
    try {
        const response = await apiCall(`/admin/api/images/${encodeURIComponent(path)}/restore`, {
            method: 'POST'
        });

        if (response && response.ok) {
            loadProductImages();
        }
    } catch (error) {
        alert('Error restoring image');
    }
}

// ============================================================================
// Upload (Legacy - keeping for backward compatibility)
// ============================================================================
function initUpload() {
    const uploadZone = document.getElementById('uploadZone');
    const pdfInput = document.getElementById('pdfInput');
    if (!uploadZone || !pdfInput) return;

    uploadZone.addEventListener('click', () => pdfInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
            uploadPDF(file);
        }
    });

    pdfInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) uploadPDF(file);
    });
}

async function uploadPDF(file) {
    const progressDiv = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const statusText = document.getElementById('uploadStatus');
    const resultDiv = document.getElementById('uploadResult');
    const uploadZone = document.getElementById('uploadZone');

    uploadZone.style.display = 'none';
    progressDiv.style.display = 'block';
    resultDiv.style.display = 'none';

    const formData = new FormData();
    formData.append('file', file);

    try {
        // Start upload
        statusText.textContent = 'Uploading PDF...';
        progressFill.style.width = '20%';

        const response = await fetch('/admin/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });

        if (!response.ok) {
            throw new Error('Upload failed');
        }

        // Processing stages
        statusText.textContent = 'Analyzing PDF pages...';
        progressFill.style.width = '40%';

        // Poll for status
        let processing = true;
        while (processing) {
            await new Promise(resolve => setTimeout(resolve, 2000));

            const statusResponse = await apiCall('/admin/api/processing-status');
            const status = await statusResponse.json();

            if (status.stage === 'analyzing') {
                statusText.textContent = `Analyzing page ${status.current_page}/${status.total_pages}...`;
                progressFill.style.width = `${40 + (status.current_page / status.total_pages) * 30}%`;
            } else if (status.stage === 'generating') {
                statusText.textContent = 'Generating presentation...';
                progressFill.style.width = '80%';
            } else if (status.stage === 'complete') {
                processing = false;
                progressFill.style.width = '100%';
            } else if (status.stage === 'error') {
                throw new Error(status.message);
            }
        }

        // Success
        statusText.textContent = 'Complete!';
        setTimeout(() => {
            progressDiv.style.display = 'none';
            resultDiv.style.display = 'block';
        }, 500);

    } catch (error) {
        console.error('Upload error:', error);
        statusText.textContent = `Error: ${error.message}`;
        progressFill.style.background = 'var(--error)';
    }
}

// ============================================================================
// Content Manager
// ============================================================================
async function loadContent() {
    // Load products for dropdown
    await loadProducts();
    populateProductDropdowns();

    // If no product selected, show placeholder
    if (!selectedProductId) {
        document.getElementById('presentationJSON').value = 'Select a product to view its content';
        document.getElementById('analysisJSON').value = 'Select a product to view its content';
        document.getElementById('imagesGrid').innerHTML = '<p class="text-muted">Select a product to view images</p>';
        document.getElementById('imageCount').textContent = '0 images';
    } else {
        loadProductContent();
    }
}

async function loadJSON(type) {
    try {
        const response = await apiCall(`/admin/api/json/${type}`);
        if (!response) return;

        const data = await response.json();
        const textarea = document.getElementById(`${type}JSON`);
        textarea.value = JSON.stringify(data, null, 2);
    } catch (error) {
        console.error(`Error loading ${type} JSON:`, error);
        document.getElementById(`${type}JSON`).value = `Error loading ${type}.json`;
    }
}

function formatJSON(type) {
    const textarea = document.getElementById(`${type}JSON`);
    try {
        const data = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(data, null, 2);
    } catch (error) {
        alert('Invalid JSON format');
    }
}

async function saveJSON(type) {
    const textarea = document.getElementById(`${type}JSON`);

    try {
        const data = JSON.parse(textarea.value);

        const response = await apiCall(`/admin/api/json/${type}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        if (response && response.ok) {
            alert(`${type}.json saved successfully!`);
        } else {
            throw new Error('Save failed');
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

async function loadImages() {
    try {
        const showDeleted = document.getElementById('showDeleted')?.checked || false;
        const response = await apiCall(`/admin/api/images?show_deleted=${showDeleted}`);
        if (!response) return;

        const images = await response.json();
        const grid = document.getElementById('imagesGrid');
        const count = document.getElementById('imageCount');

        count.textContent = `${images.length} images`;

        grid.innerHTML = images.map(img => `
            <div class="image-card ${img.is_deleted ? 'deleted' : ''}">
                <img src="/images/${img.path.replace('output/images/', '')}" alt="${img.path}"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%231a1a2e%22 width=%22200%22 height=%22150%22/><text fill=%22%2394a3b8%22 x=%22100%22 y=%2275%22 text-anchor=%22middle%22>No preview</text></svg>'">
                <div class="image-info">
                    <p class="image-path">${img.path}</p>
                    <div class="image-actions">
                        ${img.is_deleted
                            ? `<button class="restore-btn" onclick="restoreImage('${img.path}')">
                                 <i class="fas fa-undo"></i> Restore
                               </button>`
                            : `<button class="delete-btn" onclick="deleteImage('${img.path}')">
                                 <i class="fas fa-trash"></i> Delete
                               </button>`
                        }
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading images:', error);
    }
}

async function deleteImage(path) {
    if (!confirm('Delete this image? It will be hidden from the frontend.')) return;

    try {
        const response = await apiCall(`/admin/api/images/${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            loadImages();
        }
    } catch (error) {
        alert('Error deleting image');
    }
}

async function restoreImage(path) {
    try {
        const response = await apiCall(`/admin/api/images/${encodeURIComponent(path)}/restore`, {
            method: 'POST'
        });

        if (response && response.ok) {
            loadImages();
        }
    } catch (error) {
        alert('Error restoring image');
    }
}

// Content tabs
function initContentTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;

            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`${tab}Tab`).classList.add('active');
        });
    });
}

// ============================================================================
// Users
// ============================================================================
let allUsers = [];

async function loadUsers() {
    try {
        const response = await apiCall('/admin/api/users');
        if (!response) return;

        allUsers = await response.json();
        renderUsersTable(allUsers);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.name}</td>
            <td>${user.email}</td>
            <td>${user.phone || '-'}</td>
            <td>${formatDate(user.registered_at)}</td>
            <td>${formatDate(user.last_active)}</td>
            <td class="actions">
                <button class="action-btn-small view-btn" onclick="viewUserChat(${user.id}, '${user.name}')">
                    <i class="fas fa-comments"></i> Chat
                </button>
                <button class="action-btn-small delete-btn" onclick="deleteUser(${user.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function initUserSearch() {
    const searchInput = document.getElementById('userSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = allUsers.filter(user =>
                user.name.toLowerCase().includes(query) ||
                user.email.toLowerCase().includes(query) ||
                (user.phone && user.phone.includes(query))
            );
            renderUsersTable(filtered);
        });
    }
}

async function viewUserChat(userId, userName) {
    try {
        const response = await apiCall(`/admin/api/users/${userId}/chat`);
        if (!response) return;

        const messages = await response.json();
        const chatHistory = document.getElementById('chatHistory');
        const userNameSpan = document.getElementById('chatUserName');

        userNameSpan.textContent = userName;

        if (messages.length === 0) {
            chatHistory.innerHTML = '<p class="text-muted">No chat history</p>';
        } else {
            chatHistory.innerHTML = messages.map(msg => `
                <div class="chat-message ${msg.role}">
                    <div class="bubble">${msg.message}</div>
                    <span class="time">${formatTime(msg.timestamp)}</span>
                </div>
            `).join('');
        }

        document.getElementById('chatModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading chat:', error);
    }
}

function closeChatModal() {
    document.getElementById('chatModal').style.display = 'none';
}

async function deleteUser(userId) {
    if (!confirm('Delete this user and all their chat history?')) return;

    try {
        const response = await apiCall(`/admin/api/users/${userId}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            loadUsers();
        }
    } catch (error) {
        alert('Error deleting user');
    }
}

// ============================================================================
// Analytics
// ============================================================================
async function loadAnalytics() {
    try {
        const response = await apiCall('/admin/api/analytics/summary');
        if (!response) return;

        const data = await response.json();

        // Render user growth chart
        renderChart('userGrowthChart', data.user_growth || [], 'Users');

        // Render activity chart
        renderChart('activityChart', data.daily_activity || [], 'Events');
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

function renderChart(containerId, data, label) {
    const container = document.getElementById(containerId);
    if (!data.length) {
        container.innerHTML = '<p class="text-muted">No data available</p>';
        return;
    }

    const maxValue = Math.max(...data.map(d => d.count), 1);

    container.innerHTML = data.map(d => {
        const height = (d.count / maxValue) * 150 + 20;
        const day = new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' });
        return `<div class="chart-bar" style="height: ${height}px" data-label="${day}" data-value="${d.count}"></div>`;
    }).join('');
}

// ============================================================================
// Settings
// ============================================================================
async function loadSettings() {
    try {
        const response = await apiCall('/admin/api/settings');
        if (!response) return;

        const settings = await response.json();

        document.getElementById('ttsVoice').value = settings.tts_voice || 'asteria';
        document.getElementById('presentationSpeed').value = settings.presentation_speed || 1;
        document.getElementById('speedValue').textContent = `${settings.presentation_speed || 1}x`;
        document.getElementById('sectionDelay').value = settings.section_delay || '0.5';
        document.getElementById('ttsEnabled').checked = settings.tts_enabled === 'true';
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function initSettings() {
    const speedSlider = document.getElementById('presentationSpeed');
    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
            document.getElementById('speedValue').textContent = `${e.target.value}x`;
        });
    }

    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const settings = {
                tts_voice: document.getElementById('ttsVoice').value,
                presentation_speed: document.getElementById('presentationSpeed').value,
                section_delay: document.getElementById('sectionDelay').value,
                tts_enabled: document.getElementById('ttsEnabled').checked ? 'true' : 'false'
            };

            try {
                const response = await apiCall('/admin/api/settings', {
                    method: 'PUT',
                    body: JSON.stringify(settings)
                });

                if (response && response.ok) {
                    alert('Settings saved successfully!');
                } else {
                    throw new Error('Save failed');
                }
            } catch (error) {
                alert('Error saving settings');
            }
        });
    }
}

// ============================================================================
// Utilities
// ============================================================================
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return formatDate(dateStr);
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    // Setup navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            showPage(item.dataset.page);
        });
    });

    // Handle browser back/forward buttons
    window.addEventListener('hashchange', () => {
        const page = getPageFromHash();
        showPage(page, false); // Don't update hash again
    });

    // Initialize all components
    initProducts();
    initUpload();
    initContentTabs();
    initUserSearch();
    initSettings();

    // Load the page from URL hash (or dashboard if no hash)
    const initialPage = getPageFromHash();
    showPage(initialPage, true);
});
