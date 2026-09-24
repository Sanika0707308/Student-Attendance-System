/**
 * Comprehensive, general-purpose email validation module for frontend.
 *
 * Validates complete email structure:
 * - Trims leading and trailing spaces.
 * - Local part: RFC compliant, 1-64 characters, no leading/trailing dot, no consecutive dots.
 * - Domain part: 1-253 characters, valid labels (1-63 chars, alphanumeric with optional hyphens),
 *   no leading/trailing hyphen or dot, no consecutive dots.
 * - TLD (Top-Level Domain): Validates genuine country-code (ccTLD) and generic (gTLD) extensions.
 * - Explicitly rejects invalid extensions (e.g. .con, .cmo, .comm).
 * - Rejects known typo domains (e.g. gamail.com, outlok.com).
 * - Does NOT restrict to Gmail or hardcoded providers; supports any legitimate provider,
 *   corporate domain, educational institution (.edu, .ac.in), etc.
 */

(function () {
    // ISO 3166-1 alpha-2 valid country code TLDs
    const CCTLDS = new Set([
        "ac", "ad", "ae", "af", "ag", "ai", "al", "am", "ao", "aq", "ar", "as", "at",
        "au", "aw", "ax", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj",
        "bm", "bn", "bo", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd",
        "cf", "cg", "ch", "ci", "ck", "cl", "cm", "cn", "co", "cr", "cu", "cv", "cw",
        "cx", "cy", "cz", "de", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "er",
        "es", "et", "eu", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge",
        "gf", "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu",
        "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu", "id", "ie", "il", "im", "in",
        "io", "iq", "ir", "is", "it", "je", "jm", "jo", "jp", "ke", "kg", "kh", "ki",
        "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr",
        "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me", "mf", "mg", "mh", "mk",
        "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx",
        "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nu",
        "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr", "ps",
        "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd",
        "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st",
        "su", "sv", "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl",
        "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "uk", "us", "uy",
        "uz", "va", "vc", "ve", "vg", "vi", "vn", "vu", "wf", "ws", "ye", "yt", "za",
        "zm", "zw"
    ]);

    // Standard generic, sponsored, and new gTLDs
    const GTLDS = new Set([
        // Original & Sponsored
        "com", "org", "net", "edu", "gov", "mil", "int", "info", "biz", "name", "pro",
        "aero", "coop", "museum", "jobs", "mobi", "travel", "tel", "asia", "cat", "post", "xxx", "arpa",
        // Modern / Tech / Business / Global
        "academy", "accountant", "accountants", "active", "actor", "adult", "agency", "airforce",
        "apartments", "app", "archi", "army", "associates", "attorney", "auction", "audio",
        "autos", "auto", "band", "bar", "bargains", "bayern", "beer", "berlin", "best", "bet",
        "bid", "bike", "bingo", "bio", "black", "blackfriday", "blog", "blue", "boutique",
        "build", "builders", "business", "buzz", "cab", "cafe", "camera", "camp", "capital",
        "cards", "care", "career", "careers", "cars", "casa", "cash", "casino", "catering",
        "center", "ceo", "channel", "chat", "cheap", "church", "city", "claims", "cleaning",
        "click", "clinic", "clothing", "cloud", "club", "coach", "codes", "coffee", "college",
        "community", "company", "computer", "condos", "construction", "consulting", "contact",
        "contractors", "cooking", "cool", "country", "coupons", "credit", "creditcard", "cricket",
        "cruises", "dance", "dating", "deals", "degree", "delivery", "democrat", "dental",
        "dentist", "design", "dev", "diamonds", "diet", "digital", "direct", "directory",
        "discount", "doctor", "dog", "domains", "download", "earth", "eco", "education",
        "email", "energy", "engineer", "engineering", "enterprises", "equipment", "estate",
        "events", "exchange", "expert", "exposed", "express", "fail", "faith", "family",
        "fans", "farm", "fashion", "feedback", "film", "finance", "financial", "fish", "fishing",
        "fit", "fitness", "flights", "florist", "flowers", "football", "forsale", "foundation",
        "fund", "furniture", "futbol", "fyi", "gallery", "game", "games", "garden", "gift",
        "gifts", "gives", "glass", "global", "gold", "golf", "graphics", "gratis", "green",
        "gripe", "group", "guide", "guitars", "guru", "haus", "healthcare", "help", "here",
        "hiphop", "hiv", "hockey", "holdings", "holiday", "homes", "horse", "hospital",
        "host", "hosting", "house", "how", "icu", "immo", "immobilien", "inc", "industries",
        "institute", "insure", "international", "investments", "irish", "jewelry", "kitchen",
        "land", "law", "lawyer", "lease", "legal", "life", "lighting", "limited", "limo",
        "link", "live", "living", "llc", "ltd", "loan", "loans", "lotto", "love", "luxe",
        "luxury", "management", "market", "marketing", "markets", "mba", "media", "meet",
        "memorial", "men", "menu", "moda", "moe", "money", "mortgage", "movie", "navy",
        "network", "news", "ngo", "ninja", "one", "ong", "onl", "online", "ooo", "organic",
        "partners", "parts", "party", "pharmacy", "photo", "photography", "photos", "physio",
        "pics", "pictures", "pink", "pizza", "place", "plumbing", "plus", "poker", "press",
        "productions", "properties", "property", "pub", "qpon", "racing", "recipes", "red",
        "rehab", "reise", "reisen", "reit", "ren", "rent", "rentals", "repair", "report",
        "republican", "rest", "restaurant", "review", "reviews", "rich", "rip", "rocks",
        "rodeo", "run", "sale", "salon", "sarl", "school", "schule", "science", "security",
        "services", "sex", "shiksha", "shoes", "shop", "shopping", "show", "singles", "site",
        "ski", "soccer", "social", "software", "sohu", "solar", "solutions", "soy", "space",
        "sport", "sports", "srl", "store", "stream", "studio", "study", "style", "sucks",
        "supplies", "supply", "support", "surf", "surgery", "systems", "tax", "taxi", "team",
        "tech", "technology", "tennis", "theater", "theatre", "tienda", "tips", "tires",
        "today", "tools", "top", "tours", "town", "toys", "trade", "trading", "training",
        "tube", "university", "uno", "vacations", "ventures", "vet", "viajes", "video",
        "villas", "vin", "vip", "vision", "vodka", "vote", "voting", "voyage", "watch",
        "webcam", "website", "wed", "wedding", "whoswho", "wien", "wiki", "win", "wine",
        "work", "works", "world", "ws", "wtc", "wtf", "xyz", "yoga", "zone"
    ]);

    // Explicitly invalid / common typo extensions
    const KNOWN_INVALID_TLDS = new Set([
        "con", "cmo", "comm", "coom", "cpm", "col", "vom", "xom", "ocm",
        "coo", "cmm", "ogr", "orgg", "nte", "nett", "eddu", "gvo",
        "test", "example", "invalid", "localhost", "local", "onion", "internal"
    ]);

    // Known typo domains that users accidentally type
    const TYPO_DOMAINS = new Set([
        "gamail.com", "gamil.com", "gmai.com", "gmal.com", "gmaill.com",
        "yaho.com", "yaho.co.in", "hotmial.com", "outlok.com", "outloo.com"
    ]);

    const LOCAL_PART_REGEX = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
    const DOMAIN_LABEL_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

    function validateEmailAddress(rawEmail) {
        if (!rawEmail || typeof rawEmail !== "string") {
            return { valid: false, email: "", error: "Email address is required." };
        }

        const email = rawEmail.trim();
        if (!email) {
            return { valid: false, email: "", error: "Email address cannot be empty or only spaces." };
        }

        if (email.length > 254) {
            return { valid: false, email, error: "Email address is too long (maximum 254 characters)." };
        }

        // Must contain exactly one '@'
        const atCount = (email.match(/@/g) || []).length;
        if (atCount !== 1) {
            if (atCount === 0) {
                return { valid: false, email, error: "Invalid email format: missing '@' symbol." };
            }
            return { valid: false, email, error: "Invalid email format: multiple '@' symbols found." };
        }

        const parts = email.split("@");
        const localPart = parts[0];
        const domainPart = parts[1];

        // Local part checks
        if (!localPart) {
            return { valid: false, email, error: "Invalid email format: local part before '@' is missing." };
        }

        if (localPart.length > 64) {
            return { valid: false, email, error: "Email local part is too long (maximum 64 characters)." };
        }

        if (localPart.startsWith(".") || localPart.endsWith(".")) {
            return { valid: false, email, error: "Email local part cannot start or end with a dot ('.')." };
        }

        if (localPart.includes("..")) {
            return { valid: false, email, error: "Email local part cannot contain consecutive dots ('..')." };
        }

        if (!LOCAL_PART_REGEX.test(localPart)) {
            return { valid: false, email, error: "Email local part contains invalid characters." };
        }

        // Domain part checks
        if (!domainPart) {
            return { valid: false, email, error: "Invalid email format: domain part after '@' is missing." };
        }

        if (domainPart.length > 253) {
            return { valid: false, email, error: "Email domain is too long (maximum 253 characters)." };
        }

        if (domainPart.startsWith(".") || domainPart.endsWith(".")) {
            return { valid: false, email, error: "Email domain cannot start or end with a dot ('.')." };
        }

        if (domainPart.includes("..")) {
            return { valid: false, email, error: "Email domain cannot contain consecutive dots ('..')." };
        }

        if (domainPart.startsWith("-") || domainPart.endsWith("-")) {
            return { valid: false, email, error: "Email domain cannot start or end with a hyphen ('-')." };
        }

        if (!domainPart.includes(".")) {
            return { valid: false, email, error: "Invalid email domain: missing domain extension/TLD (e.g. .com)." };
        }

        const domainLower = domainPart.toLowerCase();

        // Check for known domain typos
        if (TYPO_DOMAINS.has(domainLower)) {
            return { valid: false, email, error: `Invalid email domain "${domainPart}". Please check for typos (e.g. gmail.com).` };
        }

        const labels = domainLower.split(".");
        if (labels.length < 2) {
            return { valid: false, email, error: "Invalid email domain structure." };
        }

        // Validate each domain label
        for (const label of labels) {
            if (!label) {
                return { valid: false, email, error: "Invalid email domain: empty segment found." };
            }
            if (label.length > 63) {
                return { valid: false, email, error: `Domain label "${label}" exceeds maximum length of 63 characters.` };
            }
            if (label.startsWith("-") || label.endsWith("-")) {
                return { valid: false, email, error: `Domain label "${label}" cannot start or end with a hyphen ('-').` };
            }
            if (!DOMAIN_LABEL_REGEX.test(label)) {
                return { valid: false, email, error: `Domain label "${label}" contains invalid characters.` };
            }
        }

        // Top-Level Domain (TLD) checks
        const tld = labels[labels.length - 1];
        if (!/^[a-zA-Z]+$/.test(tld)) {
            return { valid: false, email, error: `Top-level domain extension ".${tld}" must contain only letters.` };
        }

        if (tld.length < 2) {
            return { valid: false, email, error: `Top-level domain extension ".${tld}" is too short.` };
        }

        if (KNOWN_INVALID_TLDS.has(tld)) {
            return { valid: false, email, error: `Invalid domain extension ".${tld}". Please enter a valid top-level domain (e.g. .com, .in, .org).` };
        }

        if (!CCTLDS.has(tld) && !GTLDS.has(tld)) {
            return { valid: false, email, error: `Unrecognized domain extension ".${tld}". Please verify the email address.` };
        }

        const normalizedEmail = `${localPart.toLowerCase()}@${domainLower}`;
        return { valid: true, email: normalizedEmail, error: "" };
    }

    // Export globally for browser or Node environment
    if (typeof window !== "undefined") {
        window.validateEmailAddress = validateEmailAddress;
    }
    if (typeof module !== "undefined" && module.exports) {
        module.exports = { validateEmailAddress };
    }
})();
