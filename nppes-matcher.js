/**
 * NPPESMatcher class for looking up healthcare providers in the NPPES registry
 */
class NPPESMatcher {
    constructor() {
        this.baseUrl = "https://npiregistry.cms.hhs.gov/api/";
        this.rateLimitDelay = 500; // 500ms to avoid rate limiting
        this.addressTypes = ['LOCATION', 'MAILING', 'PRIMARY', 'SECONDARY'];
    }

    /**
     * Calculate string similarity using Levenshtein distance
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Similarity ratio between 0 and 1
     */
    stringSimilarity(str1, str2) {
        if (!str1 || !str2) {
            return 0.0;
        }

        str1 = str1.toLowerCase();
        str2 = str2.toLowerCase();

        // Using Levenshtein distance for similarity
        const len1 = str1.length;
        const len2 = str2.length;
        const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));

        for (let i = 0; i <= len1; i++) matrix[i][0] = i;
        for (let j = 0; j <= len2; j++) matrix[0][j] = j;

        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,      // deletion
                    matrix[i][j - 1] + 1,      // insertion
                    matrix[i - 1][j - 1] + cost // substitution
                );
            }
        }

        const distance = matrix[len1][len2];
        const maxLen = Math.max(len1, len2);
        
        return maxLen === 0 ? 1.0 : 1.0 - (distance / maxLen);
    }

    /**
     * Check if provider zip matches any address in NPI record
     * @param {string} providerZip - Provider's zip code
     * @param {Array} npiAddresses - List of addresses from NPI record
     * @returns {Array} Match score and address type
     */
    checkAddressMatch(providerZip, npiAddresses) {
        if (!npiAddresses || !Array.isArray(npiAddresses)) {
            return [0.0, null];
        }

        for (const addr of npiAddresses) {
            if (providerZip && providerZip === (addr.postal_code || '').trim()) {
                return [1.0, addr.address_purpose];
            }
        }
        return [0.0, null];
    }

    /**
     * Search for a provider in NPPES registry
     * @param {string} firstName - Provider's first name
     * @param {string} lastName - Provider's last name
     * @param {boolean} exact - If true, performs exact match; if false, uses wildcard
     * @returns {Promise<Array>} List of matching providers
     */
    async searchProvider(firstName, lastName, exact = true) {
        let firstNameParam, lastNameParam;

        if (exact) {
            // Exact name search
            firstNameParam = firstName;
            lastNameParam = lastName;
        } else {
            // Wildcard search
            firstNameParam = firstName ? `*${firstName}*` : "*";
            lastNameParam = lastName ? `*${lastName}*` : "*";
        }

        const params = new URLSearchParams({
            'version': '2.1',
            'first_name': firstNameParam,
            'last_name': lastNameParam,
            'limit': 20,
            'skip': 0
        });

        try {
            // Using fetch for API calls
            const response = await fetch(`${this.baseUrl}?${params}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.result_count === 0) {
                return [];
            }
            
            return data.results;
        } catch (error) {
            console.error(`Error searching for ${firstName} ${lastName}: ${error.message}`);
            return [];
        }
    }

    /**
     * Introduce a delay to avoid rate limiting
     * @returns {Promise} Promise that resolves after the delay
     */
    async delay() {
        return new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
    }
}