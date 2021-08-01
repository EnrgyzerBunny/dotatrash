#imports
import mysql.connector
import requests
#import time - no need for time waits any more due to custom sql endpoint being available
import datetime

#DB
TRASH_DB = mysql.connector.connect(
    host="localhost",
    user="trashbot",
    password="password",
    database="EnrgyzerBunny_Collider"
)

#endpoints - Relevant player IDs wont change until next season, no need to pull dynamically
RESULT_ENDPOINT = """https://api.opendota.com/api/explorer?sql=SELECT
matches.match_id,
player_matches.account_id,
matches.start_time,
player_matches.kills,
player_matches.deaths,
player_matches.last_hits,
player_matches.denies,
player_matches.gold_per_min,
player_matches.towers_killed,
player_matches.roshans_killed,
player_matches.teamfight_participation,
player_matches.obs_placed,
player_matches.camps_stacked,
player_matches.rune_pickups,
player_matches.firstblood_claimed,
player_matches.stuns
FROM matches
JOIN match_patch using(match_id)
JOIN player_matches using(match_id)
LEFT JOIN notable_players ON notable_players.account_id = player_matches.account_id
WHERE TRUE
AND player_matches.account_id IN (72312627,125581247,106863163,101695162,89117038,87278757,84772440,100471531,137193239,107803494,134276083,89423756,139876032,139937922,94054712,88271237,19672354,168028715,157475523,138543123,129958758,207829314,154715080,102099826,132309493,184950344,108452107,86726887,47434686,86745912,111620041,41231571,25907144,94155156,221666230,73562326,117956848,103735745,292921272,143693439,145550466,164685175,153836240,121769650,157989498,119631156,148215639,412753955,173978074,118134220,111114687,124801257,56351509,480412663,317880638,187758589,87063175,202217968,138857296,101259972,375507918,94281932,121404228,136829091,277141004,373520478,12231202,18180970,94049589,95825708,59463394,407321629,349310876,186837494,97658618,238239590,126212866,38628747,86822085,85937380,105045291,81306398,321580662,114933489,302214028,256156323,113331514,90882159,113435203,99983413)
AND matches.match_id > <LAST_ID>
ORDER BY matches.match_id NULLS LAST
LIMIT 200"""


print(datetime.datetime.now())

#mySQL cursor
TRASH_CURSOR = TRASH_DB.cursor()

#Get latest parsed match ID
TRASH_CURSOR.execute("SELECT MatchID FROM Result ORDER BY MatchID DESC LIMIT 1")
queryResult = TRASH_CURSOR.fetchall()
print(queryResult[0][0])
lastID = queryResult[0][0]

RESULT_ENDPOINT = RESULT_ENDPOINT.replace("<LAST_ID>",str(lastID))
#switch back to above when DB is seeded - currently would cause error due to result amount
#RESULT_ENDPOINT = RESULT_ENDPOINT.replace("<LAST_ID>","6101490646")


pullResponse = requests.get(RESULT_ENDPOINT)
print(pullResponse)
rows = pullResponse.json()["rows"]
print(str(len(rows)) + " rows received")
#print(rows)

#validate rows
errorRows = []
if (len(rows) > 0):
    for i, row in enumerate(rows):
        if (row["match_id"] is None or \
            row["account_id"] is None or \
            row["start_time"] is None or \
            row["kills"] is None or \
            row["deaths"] is None or \
            row["last_hits"] is None or \
            row["denies"] is None or \
            row["gold_per_min"] is None or \
            row["towers_killed"] is None or \
            row["roshans_killed"] is None or \
            row["teamfight_participation"] is None or \
            row["obs_placed"] is None or \
            row["camps_stacked"] is None or \
            row["rune_pickups"] is None or \
            row["firstblood_claimed"] is None or \
            row["stuns"] is None):
            errorRows.append(row)

#write out error rows to file
if (len(errorRows) > 0):
    with open('ERROR_ROWS.log', 'a+') as f:
        for i, row in enumerate(errorRows):
            f.write("{0}\n".format(row))
    f.close()

    for i, row in enumerate(errorRows):
        rows.remove(row)

print(str(len(rows)) + " rows validated. " + str(len(errorRows)) + " error rows.")


if (len(rows) > 0):
    insertQuery = "INSERT INTO Result (MatchID, PlayerID, MatchDate, Kills, \
    Deaths, LastHits, Denies, GPM, Tower, Rosh, Participation, Observers, \
    Stacks, Runes, FirstBloods, Stun) VALUES "

    #insert into result table
    for i, row in enumerate(rows):
        insertQuery += "(" + \
        str(row["match_id"]) + "," + \
        str(row["account_id"]) + "," + \
        "from_unixtime(" + str(row["start_time"]) + ")" + "," + \
        str(row["kills"]) + "," + \
        str(row["deaths"]) + "," + \
        str(row["last_hits"]) + "," + \
        str(row["denies"]) + "," + \
        str(row["gold_per_min"]) + "," + \
        str(row["towers_killed"]) + "," + \
        str(row["roshans_killed"]) + "," + \
        str(row["teamfight_participation"]) + "," + \
        str(row["obs_placed"]) + "," + \
        str(row["camps_stacked"]) + "," + \
        str(row["rune_pickups"]) + "," + \
        str(row["firstblood_claimed"]) + "," + \
        str(row["stuns"]) + ")"

        if (i != len(rows) - 1):
            insertQuery += ", "
    
    TRASH_CURSOR.execute(insertQuery)

    #apply changes
    TRASH_DB.commit()
    print(str(len(rows)) + " new rows pushed")

TRASH_DB.close()
