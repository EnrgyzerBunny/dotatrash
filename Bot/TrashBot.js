const Discord = require('discord.js');
const fs = require("fs");
const mysql = require('mysql');

const client = new Discord.Client();
const token = require("./token.json")
const guild_id = require("./guild.json")

//server refs
const SERVER_ID = '220670947479257088';

//hacky enums
const DRAFT_MODE_OFF = 0;
const DRAFT_MODE_INIT = 1;
const DRAFT_MODE_MAIN = 2;
const DRAFT_MODE_RESOLVE = 3;

//mode vars
var DRAFT_MODE = DRAFT_MODE_OFF;

var DRAFT_ORDER = null;
var DRAFT_TURN_INDEX = 0;
var DRAFT_ROUNDS_LIMIT = 0;
var DRAFT_ROUNDS_COUNT = 0;

//timer message
var timerMessage = null;
var timerCount = 0;
var currentTimer = null;

// user mapping
var userMap;
if (fs.existsSync('data/userMapping.json')){

    let rawdata = fs.readFileSync('data/userMapping.json');
    userMap = JSON.parse(rawdata);
}
else
{
    //Send error code directly to me
    client.users.cache.get('109498432921546752').send("Error: Unable to read user mapping file");
}

//DB refrence
/*const TrashDB = mysql.createConnection({
    host: "localhost",
    user: "trashbot",
    password: "password",
    database: "EnrgyzerBunny_Collider"
});

TrashDB.connect();*/

//DB pooling
const TrashDBPool = mysql.createPool({
    connectionLimit: 10,
    host: "localhost",
    user: "trashbot",
    password: "password",
    database: "EnrgyzerBunny_Collider"

});
console.log("TrashDBPool Created.");



process.on("unhandledRejection", error => console.error("Promise rejection:", error));

client.on('ready', () => {

    console.log("Client Initiated.");

    /*
    //Discord Guild Level Command Registration ---------------------------------------------------
    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "teams",
            description: "list season teams"
            // possible options here e.g. options: [{...}]
        }
    });

    
    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "join",
            description: "Join the Dota Trash league"
            // possible options here e.g. options: [{...}]
        }
    });

    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "createteam",
            description: "Create a team for the current season"
            // possible options here e.g. options: [{...}]
        }
    });
    */

    //Discord Global Level Command Registration ---------------------------------------------------

    /* -- command registration should be maintained at API level and not called by bot
    client.api.applications(client.user.id).commands.post({
        data: {
            name: "join",
            description: "Join the Dota Trash league"
            // possible options here e.g. options: [{...}]
        }
    });

    client.api.applications(client.user.id).commands.post({
        data: {
            name: "createteam",
            description: "Create a team for the current season",
            // possible options here e.g. options: [{...}]
            options: [
                {
                    name: "name",
                    description: "Name of team",
                    type: 3,
                    required: true
                }
            ]
        }
    });
*/ 

    client.ws.on('INTERACTION_CREATE', async interaction => {
        const command = interaction.data.name.toLowerCase();
        const args = interaction.data.options;

        var user;
        var method = "GUILD";
        if (interaction.member == null){
            //slash command was sent via DM
            method = "DM";
            user = interaction.user;
        }
        else{
            user = interaction.member.user;
        }

        if (command === 'teams'){ 
            PullTeams(interaction.id, interaction.token);
        }

        if (command === 'join'){ 
            //Verify user isn't already an owner
            if (IsUser(user.id)){
                //already a user
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Unable to join: User is already a member of the league."
                        }
                    }
                });
                return;
            }

            //Add owner to TrashDB
            AddOwner(user.id);
            //Add mapping to user listing
            AddMapping(user.id);

            //Confirmation
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Joined successfully."
                    }
                }
            });
        }

        if (command === 'createteam'){ 
            //Verify user is an owner
            if (!IsUser(user.id)){
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You are not in the league, please use the /join command."
                        }
                    }
                });
                return;
            }
            //Verify owner does not already have a team
            let currentSeason = await GetCurrentSeasonId();
            console.log("Season: " + currentSeason);
            if (await HasTeam(user.id,currentSeason)) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Unable to create team: Team already exists."
                        }
                    }
                });
                return;
            }

            //Sanitize
            console.log(JSON.stringify(args));
            let teamName = null;
            for (var i = 0; i < args.length;i++)
            {
                if (args[i].name == "name"){
                    teamName = args[i].value.replace('\''||';'||'"','');
                    break;
                }
            }

            if (teamName == null){
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Unable to create team: Team name not provided."
                        }
                    }
                });
                return;
            }

            //Create
            CreateTeam(user.id, currentSeason, teamName);

            //Confirmation
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Team created successfully."
                    }
                }
            });
        }

        if (command === 'draftorder') {
            let subCommand = args[0].name;

            if (subCommand == "list")
            {
                let draftList = await GetDraftList();
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: draftList
                        }
                    }
                });

                return;
            }
            else if (subCommand == "set") {
                let order = args[0].options[0].value;
                DRAFT_ORDER = order.replace(" ","").split(',');
                order = "";
                for (var i = 0; i < DRAFT_ORDER.length;i++) {
                    order += ((i > 0)? "," : "") + DRAFT_ORDER[i];
                }

                let output = "Draft order set to:\n```\n" + order + "\n```";

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output
                        }
                    }
                });
                return;
            }
            
        }

        if (command === 'timer') {
            var length = args[0].value;
            
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Timer Created",
                        flags: 64
                    }
                }
            });

            timerCount = length;
            timerMessage = await client.guilds.cache.get(interaction.guild_id).channels.cache.get(interaction.channel_id).send("```\n" + millisecondsToTime(length) + "\n```");
            if (currentTimer != null)
            {
                clearInterval(currentTimer);
                currentTimer = null;
            }
            currentTimer = SetTimer(5000,() => UpdateDraftTimer(5000));
        }
    });
});

client.login(token.token);

function PullTeams(interactionid, interactiontoken)
{
    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;

        connection.query("SELECT * FROM Team", function (err, result, fields) {
            
            console.log(JSON.stringify(result));
    
            let output = "```\n";
    
            for (var i = 0; i < result.length;i++)
            {
                output += result[i].TeamName + " | Season " + (Number(result[i].SeasonID) + 1) + "\n";
            }
    
            output += "```";
    
    
            client.api.interactions(interactionid, interactiontoken).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: output
                    }
                }
            });
            connection.release();
            if (err) throw err;
    
        });


    });
    
    
    //console.log("Connected to TrashDB.");
    
}

function IsUser(userId){

    for (let i = 0;i < userMap.length; i++){
        if (userMap[i].discord == userId){
            return true;
        }
    }
    return false;

}

function AddOwner(userId){

    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;
        connection.query("INSERT INTO Owner(OwnerName) VALUES ('" + userId + "')", function (err, result, fields) {
            
            console.log(JSON.stringify(result));

            connection.release();
            if (err) throw err;
        });

    });
    

}

function AddMapping(userId){

    var mapping = {
        discord: userId
    };
    userMap.push(mapping);

    WriteMapping();

}

function WriteMapping(){
    let rawdata = JSON.stringify(userMap, null, 2);
    fs.writeFileSync('data/userMapping.json', rawdata, (err) => {
        if (err){
            client.users.cache.get('109498432921546752').send("Error: Unable to write user mapping file");
        }
        
    });
}

function GetCurrentSeasonId()
{
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;

            connection.query("SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1", function (err, result, fields) {
                
                console.log(JSON.stringify(result));
                resolve(Number(result[0].SeasonID));
                connection.release();
                if (err) throw err;
                
            });
        });
        

    });
}

function HasTeam(userId, currentSeason)
{
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT TeamID, SeasonID FROM Team JOIN Owner ON Team.OwnerID = Owner.OwnerID WHERE OwnerName = '" + userId + "' ORDER BY SeasonID DESC LIMIT 1", function (err, result, fields) {
                
                console.log(JSON.stringify(result));
                if (result.length == 0){
                    resolve(false);
                }
                else
                {
                    resolve(Number(result[0].SeasonID) == currentSeason);
                }
                connection.release();
                if (err) throw err;
                
            });
        });
        

    });
}

function CreateTeam(ownerName, season, teamName){
    
    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;
        connection.query("INSERT INTO Team(TeamName,SeasonID,OwnerID) SELECT '" + teamName + "', '" + season + "', OwnerID FROM Owner WHERE OwnerName = '" + ownerName + "'", function (err, result, fields) {
            
            console.log(JSON.stringify(result));
            connection.release();
            if (err) throw err;
        });
    });
    
}

function GetDraftList() {

    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT Owner.OwnerID, Owner.OwnerName FROM Owner JOIN Team ON Owner.OwnerID = Team.OwnerID WHERE Team.SeasonID = (SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1)", async function (err, result, fields) {
                
                let output = "```\n"
                for (var i = 0; i < result.length;i++)
                {
                    let nick = await client.guilds.cache.get(SERVER_ID).members.fetch(result[i].OwnerName);                    
                    output += result[i].OwnerID + " | " + nick.displayName + "\n";
                }
                output += "```";

                resolve(output);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function SetTimer(tickrate, updateFunc) {
    return setInterval(updateFunc,tickrate);
}

function UpdateDraftTimer(tickrate) {
    
    timerCount-=tickrate;
    if (timerCount <= 0)
    {
        if (currentTimer != null)
        {
            clearInterval(currentTimer);
            currentTimer = null;
            timerMessage.edit("Time's up");
            //call end func
            return;
        }
    }

    var output = "```\n" + millisecondsToTime(timerCount) + "\n```";
    

    timerMessage.edit(output);
}

function millisecondsToTime(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    const hours = Math.floor((ms  / 1000 / 3600 ) % 24)
  
    const formatted = [
        hours.toString().padStart(2,'0'),
        minutes.toString().padStart(2,'0'),
        seconds.toString().padStart(2,'0')
    ].join(':');
  
    return formatted;
}