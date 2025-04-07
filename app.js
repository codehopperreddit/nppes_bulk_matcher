document.addEventListener('DOMContentLoaded', function() {
    // UI Elements
    const inputFileElement = document.getElementById('inputFile');
    const processButton = document.getElementById('processButton');
    const downloadButton = document.getElementById('downloadButton');
    const progressBar = document.getElementById('progressBar');
    const statusElement = document.getElementById('status');
    const logContainer = document.getElementById('log-container');
    const summaryStats = document.getElementById('summary-stats');
    const summaryContent = document.getElementById('summary-content');
    
    // App state
    let isProcessing = false;
    let csvData = null;
    let processedData = null;
    let resultData = null;
    
    // Event listeners
    inputFileElement.addEventListener('change', handleFileSelect);
    processButton.addEventListener('click', startProcessing);
    downloadButton.addEventListener('click', downloadResults);
    
    /**
     * Handle file selection
     * @param {Event} event - File input change event
     */
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }
        
        // Parse CSV file
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: function(results) {
                if (validateCSV(results.data, results.meta.fields)) {
                    csvData = results.data;
                    log(`CSV file loaded: ${file.name}`);
                    log(`Found ${csvData.length} provider records`);
                    checkRequiredColumns(results.meta.fields);
                } else {
                    csvData = null;
                }
            },
            error: function(error) {
                log(`Error parsing CSV: ${error.message}`, 'error');
                csvData = null;
            }
        });
    }
    
    /**
     * Check if CSV has required columns
     * @param {Array} fields - CSV column names
     */
    function checkRequiredColumns(fields) {
        const requiredColumns = ['First Name', 'Last Name', 'Zip'];
        const missingColumns = requiredColumns.filter(col => !fields.includes(col));
        
        if (missingColumns.length > 0) {
            log(`Error: Missing required columns: ${missingColumns.join(', ')}`, 'error');
            return false;
        }
        
        log('CSV contains all required columns: First Name, Last Name, Zip');
        return true;
    }
    
    /**
     * Validate the CSV data format
     * @param {Array} data - Parsed CSV data
     * @param {Array} fields - CSV column names
     * @returns {boolean} Whether CSV is valid
     */
    function validateCSV(data, fields) {
        if (!data || data.length === 0) {
            log('Error: CSV file is empty', 'error');
            return false;
        }
        
        const requiredColumns = ['First Name', 'Last Name', 'Zip'];
        const hasRequiredColumns = requiredColumns.every(col => fields.includes(col));
        
        if (!hasRequiredColumns) {
            log(`Error: CSV must contain columns: ${requiredColumns.join(', ')}`, 'error');
            return false;
        }
        
        return true;
    }
    
    /**
     * Start processing providers
     */
    async function startProcessing() {
        if (isProcessing || !csvData) {
            return;
        }
        
        try {
            isProcessing = true;
            processButton.disabled = true;
            downloadButton.disabled = true;
            updateProgress(0);
            updateStatus('Processing...');
            clearLog();
            summaryStats.classList.add('d-none');
            
            log('Starting provider matching process...');
            
            // Create matcher instance
            const matcher = new NPPESMatcher();
            const results = [];
            const totalProviders = csvData.length;
            
            for (let idx = 0; idx < totalProviders; idx++) {
                const row = csvData[idx];
                const progressPct = Math.round((idx / totalProviders) * 100);
                
                updateProgress(progressPct);
                updateStatus(`Processing provider ${idx + 1}/${totalProviders}`);
                
                log(`Processing provider ${idx + 1}/${totalProviders}: ${row['First Name']} ${row['Last Name']}`);
                
                let bestMatch = null;
                let bestMatchScore = 0;
                let bestAddressType = null;
                let matchMethod = null;
                
                // Step 1: Try exact name match first
                const exactMatches = await matcher.searchProvider(
                    row['First Name'],
                    row['Last Name'],
                    true
                );
                await matcher.delay();
                
                let matches;
                
                // Step 2: If no exact matches, try wildcard match
                if (!exactMatches || exactMatches.length === 0) {
                    const wildcardMatches = await matcher.searchProvider(
                        row['First Name'],
                        row['Last Name'],
                        false
                    );
                    await matcher.delay();
                    
                    matches = wildcardMatches;
                    if (matches && matches.length > 0) {
                        matchMethod = "WILDCARD";
                    }
                } else {
                    matches = exactMatches;
                    matchMethod = "EXACT";
                }
                
                if (matches && matches.length > 0) {
                    // If only one match, use it
                    if (matches.length === 1) {
                        bestMatch = matches[0];
                        bestMatchScore = 1.0;
                        bestAddressType = matches[0].addresses && matches[0].addresses.length > 0 ? 
                            matches[0].addresses[0].address_purpose : null;
                    }
                    // If multiple matches, filter by zip
                    else {
                        matchMethod += "_WITH_ZIP";
                        for (const match of matches) {
                            const [matchScore, addrType] = matcher.checkAddressMatch(
                                row['Zip'],
                                match.addresses || []
                            );
                            
                            if (matchScore > bestMatchScore) {
                                bestMatch = match;
                                bestMatchScore = matchScore;
                                bestAddressType = addrType;
                            }
                        }
                    }
                }
                
                // Create result object
                const result = {
                    'Original Index': idx,
                    'NPI': bestMatch ? bestMatch.number : null,
                    'Match Method': bestMatch ? matchMethod : "NO_MATCH",
                    'Total Matches Found': matches ? matches.length : 0,
                    'Final Match Score': bestMatchScore,
                    'Address Type': bestAddressType,
                    'Name Match': bestMatch ? 
                        (matcher.stringSimilarity(row['First Name'], bestMatch.basic.first_name) +
                         matcher.stringSimilarity(row['Last Name'], bestMatch.basic.last_name)) / 2 : 0,
                    'Matched Provider Name': bestMatch ? 
                        `${bestMatch.basic.first_name} ${bestMatch.basic.last_name}` : null,
                    'Matched Address': bestMatch && bestMatch.addresses && bestMatch.addresses.length > 0 ? 
                        bestMatch.addresses[0].address_1 : null,
                    'Matched Zip': bestMatch && bestMatch.addresses && bestMatch.addresses.length > 0 ? 
                        bestMatch.addresses[0].postal_code : null,
                    'Matched Taxonomy': bestMatch && bestMatch.taxonomies && bestMatch.taxonomies.length > 0 ? 
                        bestMatch.taxonomies[0].desc : null,
                    'Original Name': `${row['First Name']} ${row['Last Name']}`,
                    'Original Zip': row['Zip']
                };
                
                results.push(result);
            }
            
            // Complete the process
            processedData = results;
            
            // Merge original data with results
            resultData = csvData.map((originalRow, index) => {
                return { ...originalRow, ...processedData[index] };
            });
            
            updateProgress(100);
            updateStatus('Processing complete!');
            displaySummary(processedData);
            downloadButton.disabled = false;
            
            log('\nResults processing complete!');
            
        } catch (error) {
            log(`Error during processing: ${error.message}`, 'error');
            updateStatus(`Error: ${error.message}`);
        } finally {
            isProcessing = false;
            processButton.disabled = false;
        }
    }
    
    /**
     * Display summary statistics
     * @param {Array} results - Processed results
     */
    function displaySummary(results) {
        if (!results || results.length === 0) return;
        
        // Count matches
        const totalProviders = results.length;
        const matchedProviders = results.filter(r => r.NPI !== null).length;
        
        // Count by match method
        const methodCounts = {};
        results.forEach(r => {
            const method = r['Match Method'] || 'NO_MATCH';
            methodCounts[method] = (methodCounts[method] || 0) + 1;
        });
        
        // Display summary
        let summaryHTML = `
            <p><strong>Total providers processed:</strong> ${totalProviders}</p>
            <p><strong>Providers matched:</strong> ${matchedProviders} (${Math.round(matchedProviders/totalProviders*100)}%)</p>
            <p><strong>Matching Method Breakdown:</strong></p>
            <ul>
        `;
        
        for (const [method, count] of Object.entries(methodCounts)) {
            summaryHTML += `<li>${method}: ${count} (${Math.round(count/totalProviders*100)}%)</li>`;
        }
        
        summaryHTML += `</ul>`;
        summaryContent.innerHTML = summaryHTML;
        summaryStats.classList.remove('d-none');
    }
    
    /**
     * Download results as CSV
     */
    function downloadResults() {
        if (!resultData || resultData.length === 0) return;
        
        // Convert to CSV using PapaParse
        const csv = Papa.unparse(resultData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, 'providers_with_npi_matches.csv');
        
        log('Results downloaded as CSV');
    }
    
    /**
     * Log message to UI
     * @param {string} message - Message to log
     * @param {string} type - Log type (info, error)
     */
    function log(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.textContent = message;
        
        if (type === 'error') {
            logEntry.style.color = 'red';
        }
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }
    
    /**
     * Clear log display
     */
    function clearLog() {
        logContainer.innerHTML = '';
    }
    
    /**
     * Update progress bar
     * @param {number} percentage - Progress percentage (0-100)
     */
    function updateProgress(percentage) {
        progressBar.style.width = `${percentage}%`;
        progressBar.textContent = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage);
    }
    
    /**
     * Update status text
     * @param {string} text - Status message
     */
    function updateStatus(text) {
        statusElement.textContent = text;
    }
});