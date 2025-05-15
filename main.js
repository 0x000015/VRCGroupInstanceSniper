// Created by XVF on 02 May 2025
const vrchat = require("vrchat");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "config.json");
var delayCancel = null;
var reduceDelay = false;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY)
    process.stdin.setRawMode(true);
const askPrompt = (query) => new Promise((resolve) => rl.question(query, resolve));


const Delay = ms => new Promise(resolve => { delayCancel = resolve; setTimeout(() => { delayCancel = null; resolve(); }, ms); });
let fastModeLogged = false;
let spaceTimeout = null;
let isReady = false;

// TODO: Cleanup
process.stdin.on("keypress", (str, key) => {
    if (isReady && key.name === "space") {
        // Prevent terminal from printing the space
        if (str === ' ')
            process.stdout.write('\x08');

        // Enter fast mode
        reduceDelay = true;

        if (!fastModeLogged) {
            console.log("[Spacebar Held] Fast mode enabled");
            fastModeLogged = true;
        }

        if (delayCancel) {
            delayCancel();
            delayCancel = null;
        }

        // Reset to slow mode after 1 second
        if (spaceTimeout)
            clearTimeout(spaceTimeout);
        spaceTimeout = setTimeout(() => {
            reduceDelay = false;
            fastModeLogged = false;
            console.log("[Spacebar Released] Fast mode disabled");
        }, 1000);
    }
});

var localConfig = {
    Username: "",
    Password: "",
    GroupID: "",
    AuthCookie: "",
    PriorityTimeStart: "",
    PriorityTimeEnd: "",
}

async function main() {
    await handleConfig()
    let vrcConfig = new vrchat.Configuration({
        username: localConfig.Username,
        password: localConfig.Password,
        baseOptions: {
            headers: {
                "User-Agent": "InstanceJoiner/1.2.0",
            }
        }
    });

    // Check for saved token for quick login
    if (localConfig.AuthCookie)
        vrcConfig.baseOptions.headers.Cookie = `auth=${localConfig.AuthCookie}`;

    while (true) {
        try {
            await Login(vrcConfig);
            break;
        } catch (err) {
            console.log("Failed to login. Verify credentials and try again.", err)
            await handleConfig(true)
            vrcConfig.username = localConfig.Username
            vrcConfig.password = localConfig.Password
        }
    }

    const groupAPI = new vrchat.GroupsApi(vrcConfig);
    const inviteAPI = new vrchat.InviteApi(vrcConfig);
    const groupData = await getGroupData(groupAPI);

    // Allow keypresses 
    isReady = true;
    // Loop through specified group instances constantly
    while (true) {
        const date = new Date();
        const curTime = date.getHours() * 60 + date.getMinutes();
        const groups = await getGroupInstances(groupAPI)
        if (groups.length === 0) {
            console.warn(`No group instances found for '${groupData.name}'`)
        } else { // If we found some instances, then invite us to each of them, and then break off
            for (let i = 0; i < groups.length; i++) {
                const group = groups[i];
                console.log(`Sent invite for '${groupData.name}(${group.world.name})' with '${group.memberCount}' members in`)
                await inviteAPI.inviteMyselfTo(group.world.id, group.instanceId)
            }
            console.log(`Finished sending invites. Closing`);
            Delay(1500)
            return;
        }
        // Wait either 1.5 sec, which seems to be safe for ratelimits, or 200ms if we're rushing the invites. We can only do this for about a 30 seconds before we get blocked temporarily
        await Delay(reduceDelay || shouldPrioritize(localConfig.PriorityTimeStart, localConfig.PriorityTimeEnd, curTime) ? 200 : 1500)
    }
}


async function Login(vrcConfig) {
    const authenticationApi = new vrchat.AuthenticationApi(vrcConfig);
    let currentUser;

    try {
        currentUser = (await authenticationApi.getCurrentUser()).data;
    } catch (err) {
        console.error("Initial auth failed, trying full login...");
    }

    if (!currentUser || currentUser.requiresTwoFactorAuth) {
        const loginResponse = await authenticationApi.getCurrentUser();
        currentUser = loginResponse.data;

        if (currentUser.requiresTwoFactorAuth?.includes("emailOtp")) {
            await authenticationApi.verify2FAEmailCode({ code: await askPrompt("Email Code: ") });
            currentUser = (await authenticationApi.getCurrentUser()).data;
        }

        if (currentUser.requiresTwoFactorAuth?.includes("totp")) {
            await authenticationApi.verify2FA({ code: await askPrompt("2FA Code: ") });
            currentUser = (await authenticationApi.getCurrentUser()).data;
        }
        const cookieHeader = loginResponse.config.headers?.['Cookie'] || '';
        const authToken = (/auth=([^;]+)/.exec(cookieHeader || ''))[1] || '';
        if (authToken) {
            localConfig.AuthCookie = authToken;
            saveConfig();
        }
    }
    console.log(`Logged in as '${currentUser.displayName}'`);
}

// (no this is not secure, it's not trying to be)
function obf(text) {
    const xored = Buffer.from(text, "utf8").map(byte => byte ^ 0x15);
    return xored.toString("base64");
}

function deobf(encoded) {
    const xored = Buffer.from(encoded, "base64").map(byte => byte ^ 0x15);
    return xored.toString("utf8");
}

async function handleConfig(forceConfig = false) {
    // If no config file exists, prompt the user for their credentials
    if (forceConfig || !fs.existsSync(configPath)) {
        console.log("No config found. Please enter credentials.");

    }
    localConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    await promptForConfig(forceConfig);

    // Decrypt credentials if obfuscated
    if (localConfig.Username)
        localConfig.Username = deobf(localConfig.Username);
    if (localConfig.Password)
        localConfig.Password = deobf(localConfig.Password);
    if (localConfig.AuthCookie)
        localConfig.AuthCookie = deobf(localConfig.AuthCookie);
    if (localConfig.PriorityTimeStart !== undefined && !Number.isInteger(localConfig.PriorityTimeStart))
        localConfig.PriorityTimeStart = parseTimeToMinutes(localConfig.PriorityTimeStart)
    if (localConfig.PriorityTimeEnd !== undefined && !Number.isInteger(localConfig.PriorityTimeEnd))
        localConfig.PriorityTimeEnd = parseTimeToMinutes(localConfig.PriorityTimeEnd)

    //validateConfigLength();
}

async function promptForConfig(forceConfig) {
    if (forceConfig) {

    }
    let shouldSave = false;
    const entries = [
        ["Username", "", true],
        ["Password", "", true],
        ["GroupID", ""],
        ["PriorityTimeStart", "When should we automatically start rushing checks for group instances (Example: 12:00 AM)"],
        ["PriorityTimeEnd", "When should we automatically stop rushing checks for group instances (Example: 12:05 AM)"]]
    // Loop through changable entries
    for (const fields of entries) {
        let [param, desc, force] = fields;
        // This'll skip if we already have the field set
        if ((force && localConfig[param] !== undefined && !forceConfig) || !force && localConfig[param] !== undefined)
            continue
        const answer = await askPrompt(`Enter ${param} ${fields[1] !== "" ? `[${desc}]` : ""} `);
        localConfig[param] = answer
        shouldSave = true;
    }
    if (shouldSave)
        saveConfig();
}

async function saveConfig() {
    let tmpConfig = localConfig;

    tmpConfig.AuthCookie = obf(tmpConfig.AuthCookie);
    tmpConfig.Username = obf(tmpConfig.Username);
    tmpConfig.Password = obf(tmpConfig.Password);
    fs.writeFileSync(configPath, JSON.stringify(localConfig, null, 4), "utf8");
    console.log("Saved config");
}

async function getGroupInstances(groupAPI) {
    let groupInstances;

    try {
        groupInstances = (await groupAPI.getGroupInstances(localConfig.GroupID)).data;
    } catch (err) {
        console.log('Failed to get group instances', err);
        return null;
    }
    return groupInstances
}

async function getGroupData(groupAPI) {
    let groupData;

    try {
        groupData = (await groupAPI.getGroup(localConfig.GroupID)).data;
    } catch (err) {
        console.log('Failed to get group data', err);
        return null;
    }
    return groupData
}

// Speciality just for time priority
function parseTimeToMinutes(timeStr) {
    const match = timeStr.match(/^(0?[1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM)$/i);
    if (!match)
        return null;

    let [, hour, minute, meridiem] = match;
    hour = parseInt(hour);
    minute = parseInt(minute);
    meridiem = meridiem.toUpperCase();

    if (meridiem === 'PM' && hour !== 12)
        hour += 12;
    if (meridiem === 'AM' && hour === 12)
        hour = 0;

    return hour * 60 + minute;
}


function shouldPrioritize(start, end, curTime) {
    if (start <= end)
        return curTime >= start && curTime <= end;
    else // Range crosses midnight
        return curTime >= start || curTime <= end;
}
main();
