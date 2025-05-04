// Created by XVF on 02 May 2025
const vrchat = require("vrchat");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "config.json");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askPrompt = (query) => new Promise((resolve) => rl.question(query, resolve));
const Delay = ms => new Promise(resolve => setTimeout(resolve, ms));

var localConfig = {
    Username: "",
    Password: "",
    GroupID: "",
    AuthCookie: "",
    ul: 0,
    pl: 0,
}

async function main() {
    await handleConfig()
    var vrcConfig = new vrchat.Configuration({
        username: localConfig.Username,
        password: localConfig.Password,
        baseOptions: {
            headers: { 
                "User-Agent": "InstanceJoiner/1.0.0",
             }
        }
    });

    // Check for saved token for quick login
    if (localConfig.AuthCookie)
        vrcConfig.baseOptions.headers.Cookie = `auth=${localConfig.AuthCookie}`;

    const groupAPI = new vrchat.GroupsApi(vrcConfig);
    const inviteAPI = new vrchat.InviteApi(vrcConfig);
    await Login(vrcConfig);
    const groupData = await getGroupData(groupAPI);
    
    // Loop through specified group instances
    // TODO: Add support for multiple groups as well as time priority for events
    while (true) {
        const group = await getGroupInstances(groupAPI)
        if (group != null && group.length > 0) {
            console.log(`Sent invite for '${groupData.name}(${group[0].world.name})' with '${group[0].memberCount}' members in`)
            await inviteAPI.inviteMyselfTo(group[0].world.id, group[0].instanceId)
            return
        } else {
            console.log(`No group instances found for ${groupData.name}`, group)
        }
        await Delay(1000)
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
    console.log(`Logged in as: ${currentUser.displayName}`);
    
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

async function handleConfig() {
    // If no config file exists, prompt the user for their credentials
    if (!fs.existsSync(configPath)) {
        console.log("No config found. Please enter credentials.");

        await promptForConfig();
        await saveConfig();
    }
    localConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

    // Decrypt credentials if obfuscated
    if (localConfig.Username) localConfig.Username = deobf(localConfig.Username);
    if (localConfig.Password) localConfig.Password = deobf(localConfig.Password);
    if (localConfig.AuthCookie) localConfig.AuthCookie = deobf(localConfig.AuthCookie);

    validateConfigLength();
}

async function promptForConfig() {
    // Loop through changable entries
    for (const field of ["Username", "Password", "GroupID"]) {
        if (!localConfig[field]) {
            const answer = await askPrompt(`Enter ${field}: `);
            localConfig[field] = answer

            // Store username/password lengths for validation later
            if (field === "Username") localConfig.ul = answer.length;
            if (field === "Password") localConfig.pl = answer.length;
        }
    }
}

async function saveConfig() {
    var tmpConfig = localConfig;

    tmpConfig.AuthCookie = obf(tmpConfig.AuthCookie);
    tmpConfig.Username = obf(tmpConfig.Username);
    tmpConfig.Password = obf(tmpConfig.Password);
    fs.writeFileSync(configPath, JSON.stringify(localConfig, null, 4), "utf8");
    console.log("Saved config");
}

// Validate the username/password lengths against stored values
function validateConfigLength() {
    if (localConfig.ul !== localConfig.Username.length) {
        console.log("Username length mismatch");
    }
    if (localConfig.pl !== localConfig.Password.length) {
        console.log("Password length mismatch");
    }
}

async function getGroupInstances(groupAPI) {
    let group;
    try {
        group = (await groupAPI.getGroupInstances(localConfig.GroupID)).data;
    } catch (err) {
        console.log('Failed to get group instances', err);
        return null;
    }
    return group
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
main();
