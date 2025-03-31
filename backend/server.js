import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { Sequelize, DataTypes, Op } from 'sequelize';
import crypto from 'crypto'; // For random password generation
import { format } from 'date-fns-tz'; // For formatting Expiration date

dotenv.config();

// --- Input Validation & Configuration ---
const requiredEnv = [
    'DB_URL', 'JWT_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER',
    'SMTP_PASS', 'RADIUS_BLOCKED_GROUP'
];
requiredEnv.forEach(v => {
    if (!process.env[v]) {
        console.error(`FATAL ERROR: Environment variable ${v} is not set.`);
        process.exit(1);
    }
});

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// --- Database Connection & Models ---
console.log(`Connecting to DB: ${process.env.DB_URL.replace(/:[^:]+@/, ':*****@')}`);
const sequelize = new Sequelize(process.env.DB_URL, {
    logging: process.env.NODE_ENV === 'development' ? console.log : false, // Log SQL in dev
    dialectOptions: {
        // Recommended for connections within Docker network
        connectTimeout: 10000
    }
});

// Management User Model (Stores credentials for accessing this web UI)
const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false }, // Hashed with bcrypt
    role: { type: DataTypes.ENUM('admin', 'user'), defaultValue: 'user', allowNull: false },
    departments: { type: DataTypes.JSON, allowNull: false, defaultValue: [] } // Array of department IDs user manages
}, { tableName: 'mgmt_users', underscored: true }); // Use a distinct table name

// Guest Management Model (Stores metadata about guests)
const Guest = sequelize.define('Guest', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    surname: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, unique: true, allowNull: false, validate: { isEmail: true } }, // Also RADIUS username
    valid_from: { type: DataTypes.DATE, allowNull: false },
    valid_until: { type: DataTypes.DATE, allowNull: false },
    created_by_user_id: { // Foreign key to User table
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    blocked: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
    department: { type: DataTypes.INTEGER, allowNull: false } // Assigned department ID
}, { tableName: 'mgmt_guests', underscored: true }); // Use a distinct table name

// Define relationship: A User creates many Guests
User.hasMany(Guest, { foreignKey: 'created_by_user_id' });
Guest.belongsTo(User, { foreignKey: 'created_by_user_id' });

// --- FreeRADIUS Models ---

const RadCheck = sequelize.define('RadCheck', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(64), defaultValue: '', allowNull: false },
    attribute: { type: DataTypes.STRING(64), defaultValue: '', allowNull: false },
    op: { type: DataTypes.CHAR(2), defaultValue: ':=', allowNull: false },
    value: { type: DataTypes.STRING(253), defaultValue: '', allowNull: false }
}, {
    tableName: 'radcheck',
    timestamps: false, // FreeRADIUS tables don't typically have timestamps
    indexes: [ // Standard FreeRADIUS indexes
        { fields: ['username'] }
    ]
});

const RadUserGroup = sequelize.define('RadUserGroup', {
    // id field is optional for radusergroup, username/groupname is usually the key
    username: { type: DataTypes.STRING(64), defaultValue: '', allowNull: false, primaryKey: true },
    groupname: { type: DataTypes.STRING(64), defaultValue: '', allowNull: false, primaryKey: true },
    priority: { type: DataTypes.INTEGER, defaultValue: 1, allowNull: false }
}, {
    tableName: 'radusergroup',
    timestamps: false
    // No separate id column needed if using composite primary key
});
// Optional: RadReply if you need static replies
// const RadReply = sequelize.define('RadReply', { ... }, { tableName: 'radreply', timestamps: false });


// --- Helper Functions ---
const generatePassword = (length = 10) => {
    // Generates a more readable random password (avoids ambiguous chars like I, l, 1, O, 0)
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let password = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        password += chars[randomBytes[i] % chars.length];
    }
    return password;
};

// Format date for RADIUS 'Expiration' attribute (RFC 822 like, but FreeRADIUS format specific)
// Example: "Jan 25 2024 15:30:00 UTC" - Adjust timezone/format as needed by your FreeRADIUS version/config
const formatRadiusExpiration = (date) => {
    if (!date) return null;
    // Format: Month Day Year HH:MM:SS TZ (e.g., 'Mar 14 2024 10:00:00 UTC')
    // Using date-fns-tz to handle timezone correctly
    return format(date, "MMM dd yyyy HH:mm:ss OOOO", { timeZone: 'UTC' });
};

// --- Middleware ---
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
        console.log('Auth middleware: No token provided');
        return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.log('Auth middleware: Token verification failed', err.message);
            return res.status(403).json({ message: 'Forbidden: Invalid or expired token' });
        }
        // Attach user payload (id, role, departments) to the request object
        req.user = user;
        console.log(`Auth middleware: User ${user.id} (${user.role}) authenticated.`);
        next();
    });
};

// Authorization Middleware (Example: Check if user can manage a specific department)
const canManageDepartment = (targetDepartmentId, user) => {
    if (!user) return false;
    if (user.role === 'admin') return true; // Admins can manage all
    return user.departments?.includes(parseInt(targetDepartmentId, 10)); // Users can manage their assigned departments
};

// --- Routes ---

// Register Management User (for initial setup, disable/protect afterward)
// Consider making this a CLI command or a one-time setup step instead of an open endpoint
app.post('/register', async (req, res) => {
    const { username, password, role = 'user', departments = [] } = req.body;

    // Basic validation
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }
    if (role && !['admin', 'user'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role specified.' });
    }
    if (!Array.isArray(departments)) {
         return res.status(400).json({ message: 'Departments must be an array.' });
    }

    try {
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.status(409).json({ message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            username,
            password: hashedPassword,
            role,
            departments
        });
        // Don't send password back
        const userResponse = { id: user.id, username: user.username, role: user.role, departments: user.departments };
        console.log(`User registered: ${username} (Role: ${role})`);
        res.status(201).json({ message: 'User registered successfully', user: userResponse });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error during registration' });
    }
});

// Login Management User
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const user = await User.findOne({ where: { username } });

        if (!user) {
            console.log(`Login attempt failed: User ${username} not found.`);
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            console.log(`Login attempt failed: Incorrect password for user ${username}.`);
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        // Create JWT Payload
        const payload = {
            id: user.id,
            username: user.username,
            role: user.role,
            departments: user.departments || [] // Ensure departments array exists
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' } // Make expiry configurable
        );

        console.log(`User logged in: ${username}`);
        res.json({ token });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error during login' });
    }
});

// Get Current User Info (based on token)
app.get('/me', authenticate, (req, res) => {
    // req.user is populated by the authenticate middleware
    // Return only necessary, non-sensitive info
    res.json({
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        departments: req.user.departments
    });
});


// --- Guest Management Routes ---

// Create Guest
app.post('/guests', authenticate, async (req, res) => {
    const { name, surname, email, valid_from, valid_until, department } = req.body;
    const creatingUserId = req.user.id;

    // --- Validation ---
    if (!name || !surname || !email || !valid_from || !valid_until || department === undefined || department === null) {
        return res.status(400).json({ message: 'Missing required fields: name, surname, email, valid_from, valid_until, department' });
    }
    // Basic email format check (Sequelize validation handles more)
    if (!/\S+@\S+\.\S+/.test(email)) {
       return res.status(400).json({ message: 'Invalid email format' });
    }
    // Date validation (ensure they are valid dates and until > from)
    const dateFrom = new Date(valid_from);
    const dateUntil = new Date(valid_until);
    if (isNaN(dateFrom.getTime()) || isNaN(dateUntil.getTime())) {
        return res.status(400).json({ message: 'Invalid date format for valid_from or valid_until' });
    }
    if (dateUntil <= dateFrom) {
        return res.status(400).json({ message: 'valid_until must be after valid_from' });
    }
    // --- Authorization ---
    if (!canManageDepartment(department, req.user)) {
        console.warn(`User ${req.user.id} attempted to create guest for unauthorized department ${department}`);
        return res.status(403).json({ message: 'Forbidden: You cannot create guests for this department.' });
    }

    // --- Generate Credentials ---
    const plainPassword = generatePassword(); // Generate random password

    // --- Database Operations (Transaction) ---
    let transaction;
    try {
        transaction = await sequelize.transaction();

        // Check if email (RADIUS username) already exists in radcheck or mgmt_guests
        const existingRadiusUser = await RadCheck.findOne({ where: { username: email }, transaction });
        const existingMgmtGuest = await Guest.findOne({ where: { email: email }, transaction });
        if (existingRadiusUser || existingMgmtGuest) {
            await transaction.rollback();
            return res.status(409).json({ message: `Guest with email ${email} already exists.` });
        }

        // 1. Create Metadata Guest Record
        const guest = await Guest.create({
            name,
            surname,
            email, // Will also be the RADIUS username
            valid_from: dateFrom,
            valid_until: dateUntil,
            created_by_user_id: creatingUserId,
            department: parseInt(department, 10),
            blocked: false // New guests are not blocked by default
        }, { transaction });

        // 2. Create FreeRADIUS radcheck record for password
        await RadCheck.create({
            username: email,
            attribute: 'Cleartext-Password',
            op: ':=',
            value: plainPassword // STORE PLAINTEXT PASSWORD FOR RADIUS
        }, { transaction });

        // 3. Optional: Create FreeRADIUS radcheck record for expiration
        const expirationValue = formatRadiusExpiration(dateUntil);
        if (expirationValue) {
            await RadCheck.create({
                username: email,
                attribute: 'Expiration',
                op: ':=',
                value: expirationValue
            }, { transaction });
        }
        // 4. Optional: Add to a default guest group if needed
        // await RadUserGroup.create({ username: email, groupname: 'default-guests', priority: 1 }, { transaction });

        // Commit Transaction
        await transaction.commit();

        // --- Send Email (after successful commit) ---
        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT, 10),
                secure: parseInt(process.env.SMTP_PORT, 10) === 465, // true for 465, false for other ports
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
                tls: {
                    // Necessary if your SMTP gateway uses self-signed certs
                    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'
                }
            });

            await transporter.sendMail({
                from: `"Guest WiFi System" <${process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USER}>`,
                to: email,
                subject: 'Your Guest Wi-Fi Credentials',
                text: `Welcome ${name},\n\nYour credentials for the Guest Wi-Fi are:\n\nUsername: ${email}\nPassword: ${plainPassword}\n\nYour access is valid from ${format(dateFrom, 'yyyy-MM-dd HH:mm')} until ${format(dateUntil, 'yyyy-MM-dd HH:mm')}.\n\nRegards,\nYour IT Department`,
                // Optional: HTML version
                // html: `<p>Welcome ${name},</p><p>Your credentials for the Guest Wi-Fi are:</p><p><b>Username:</b> ${email}<br/><b>Password:</b> ${plainPassword}</p><p>Your access is valid from ${format(dateFrom, 'yyyy-MM-dd HH:mm')} until ${format(dateUntil, 'yyyy-MM-dd HH:mm')}.</p><p>Regards,<br/>Your IT Department</p>`
            });
             console.log(`Guest created: ${email} by user ${creatingUserId}. Credentials sent.`);
             res.status(201).json({ message: 'Guest created and credentials sent', guest }); // Send back the created guest metadata

        } catch (emailError) {
            // Log email error, but don't fail the request if DB was successful
            console.error(`ERROR SENDING EMAIL to ${email} after creating guest:`, emailError);
            // Send response indicating success but email failure
             res.status(201).json({
                message: 'Guest created successfully, but failed to send email credentials.',
                guest: guest, // Send back the created guest metadata
                emailError: emailError.message
             });
        }

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error creating guest:', error);
        // Handle potential Sequelize validation errors
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ message: 'Validation failed', errors: error.errors.map(e => e.message) });
        }
         if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ message: `Guest with email ${email} already exists.` });
        }
        res.status(500).json({ message: 'Internal server error creating guest' });
    }
});

// List Guests
app.get('/guests', authenticate, async (req, res) => {
    try {
        let whereClause = {};
        if (req.user.role !== 'admin') {
            // Non-admins only see guests belonging to their managed departments
            if (!req.user.departments || req.user.departments.length === 0) {
                 console.log(`User ${req.user.id} has no assigned departments. Returning empty guest list.`);
                 return res.json([]); // No departments assigned, show nothing
            }
            whereClause = {
                department: {
                    [Op.in]: req.user.departments
                }
            };
        }
        // Admins see all guests (no whereClause filtering by department)

        const guests = await Guest.findAll({
            where: whereClause,
            include: [{ // Optionally include creator info (be careful about exposing data)
                model: User,
                attributes: ['id', 'username'] // Only include safe fields
            }],
            order: [['valid_until', 'DESC']] // Example ordering
        });
        res.json(guests);
    } catch (error) {
        console.error('Error fetching guests:', error);
        res.status(500).json({ message: 'Internal server error fetching guests' });
    }
});

// Update Guest (Extend Validity, Block/Unblock)
app.patch('/guests/:id', authenticate, async (req, res) => {
    const guestId = parseInt(req.params.id, 10);
    const { valid_until, blocked } = req.body; // Expecting boolean for blocked

    // Validation
    if (isNaN(guestId)) {
        return res.status(400).json({ message: 'Invalid guest ID.' });
    }
    if (valid_until === undefined && blocked === undefined) {
        return res.status(400).json({ message: 'No update data provided (valid_until or blocked).' });
    }

    let dateUntil = null;
    if (valid_until !== undefined) {
        dateUntil = new Date(valid_until);
        if (isNaN(dateUntil.getTime())) {
            return res.status(400).json({ message: 'Invalid date format for valid_until.' });
        }
    }
    if (blocked !== undefined && typeof blocked !== 'boolean') {
        return res.status(400).json({ message: 'Blocked status must be a boolean (true/false).' });
    }


    let transaction;
    try {
        transaction = await sequelize.transaction();

        // Find the guest
        const guest = await Guest.findByPk(guestId, { transaction });
        if (!guest) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Guest not found.' });
        }

        // Authorization Check
        if (!canManageDepartment(guest.department, req.user)) {
            await transaction.rollback();
            console.warn(`User ${req.user.id} attempted to update guest ${guestId} from unauthorized department ${guest.department}`);
            return res.status(403).json({ message: 'Forbidden: You cannot manage guests for this department.' });
        }

        // --- Apply Updates ---
        let changesMade = false;

        // 1. Update Validity in mgmt_guests and radcheck (Expiration)
        if (dateUntil && dateUntil.toISOString() !== guest.valid_until.toISOString()) {
            if (dateUntil <= guest.valid_from) {
                 await transaction.rollback();
                 return res.status(400).json({ message: 'valid_until must be after valid_from.' });
            }
            guest.valid_until = dateUntil;
            changesMade = true;

            // Update/Create Expiration attribute in radcheck
            const expirationValue = formatRadiusExpiration(dateUntil);
            if (expirationValue) {
                await RadCheck.update(
                    { value: expirationValue },
                    { where: { username: guest.email, attribute: 'Expiration' }, transaction }
                );
                // Check if update affected any row, if not, create it (in case it didn't exist)
                const [results] = await RadCheck.findOrCreate({
                    where: { username: guest.email, attribute: 'Expiration' },
                    defaults: { username: guest.email, attribute: 'Expiration', op: ':=', value: expirationValue },
                    transaction
                });
            } else {
                // If date is invalid/null, maybe remove expiration? Decide on behavior.
                await RadCheck.destroy({
                    where: { username: guest.email, attribute: 'Expiration' },
                    transaction
                });
            }
            console.log(`Updated validity for guest ${guest.email} to ${valid_until}`);
        }

        // 2. Update Blocked status in mgmt_guests and radusergroup
        if (blocked !== undefined && blocked !== guest.blocked) {
            guest.blocked = blocked;
            changesMade = true;
            const blockedGroupName = process.env.RADIUS_BLOCKED_GROUP;

            if (blocked) {
                // Block: Add user to the blocked group
                await RadUserGroup.findOrCreate({
                    where: { username: guest.email, groupname: blockedGroupName },
                    defaults: { username: guest.email, groupname: blockedGroupName, priority: 1 },
                    transaction
                });
                 console.log(`Blocked guest ${guest.email} by adding to group ${blockedGroupName}`);
            } else {
                // Unblock: Remove user from the blocked group
                await RadUserGroup.destroy({
                    where: { username: guest.email, groupname: blockedGroupName },
                    transaction
                });
                console.log(`Unblocked guest ${guest.email} by removing from group ${blockedGroupName}`);
            }
        }

        // Save changes to the Guest management table if any were made
        if (changesMade) {
            await guest.save({ transaction });
        }

        await transaction.commit();
        res.json({ message: 'Guest updated successfully', guest });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error(`Error updating guest ${guestId}:`, error);
        res.status(500).json({ message: 'Internal server error updating guest' });
    }
});


// Optional: Delete Guest
app.delete('/guests/:id', authenticate, async (req, res) => {
    const guestId = parseInt(req.params.id, 10);
     if (isNaN(guestId)) {
        return res.status(400).json({ message: 'Invalid guest ID.' });
    }

    let transaction;
    try {
        transaction = await sequelize.transaction();

        // Find the guest
        const guest = await Guest.findByPk(guestId, { transaction });
        if (!guest) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Guest not found.' });
        }

        // Authorization Check
        if (!canManageDepartment(guest.department, req.user)) {
            await transaction.rollback();
            console.warn(`User ${req.user.id} attempted to delete guest ${guestId} from unauthorized department ${guest.department}`);
            return res.status(403).json({ message: 'Forbidden: You cannot manage guests for this department.' });
        }

        const guestEmail = guest.email; // Store email before deleting guest object

        // 1. Delete from mgmt_guests table
        await guest.destroy({ transaction });

        // 2. Delete related records from FreeRADIUS tables
        await RadCheck.destroy({ where: { username: guestEmail }, transaction });
        await RadUserGroup.destroy({ where: { username: guestEmail }, transaction });
        // await RadReply.destroy({ where: { username: guestEmail }, transaction }); // If using RadReply

        await transaction.commit();
        console.log(`Deleted guest ${guestEmail} (ID: ${guestId}) by user ${req.user.id}`);
        res.status(200).json({ message: 'Guest deleted successfully' }); // Or 204 No Content

    } catch (error) {
         if (transaction) await transaction.rollback();
        console.error(`Error deleting guest ${guestId}:`, error);
        res.status(500).json({ message: 'Internal server error deleting guest' });
    }
});

// --- Server Start ---
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        console.log('Attempting to authenticate database connection...');
        await sequelize.authenticate();
        console.log('Database connection established successfully.');

        console.log('Synchronizing database models...');
        // Use { alter: true } in dev cautiously to update tables, avoid in prod (use migrations)
        await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
        console.log('Database models synchronized.');

        app.listen(PORT, () => {
            console.log(`🚀 Backend server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('❌ Unable to start server:', error);
        // Attempt graceful shutdown or retry logic if applicable
        process.exit(1); // Exit if essential services fail
    }
};

startServer();