#imports
import mysql.connector
import datetime






#DB
TRASH_DB = mysql.connector.connect(
    host="localhost",
    user="trashbot",
    password="password",
    database="EnrgyzerBunny_Collider"
)

print(datetime.datetime.now())

#mySQL cursor
TRASH_CURSOR = TRASH_DB.cursor()

#pull list of open requests
TRASH_CURSOR.execute("SELECT RequestID, OwnerID, RequestTime, RequestType,RequestedPlayerID, GivenPlayerID FROM Request WHERE RequestType = 0 ORDER BY RequestTime ASC")
queryResult = TRASH_CURSOR.fetchall()
print(str(len(queryResult)) + " requests")
reqs = queryResult

#pull team limit
TRASH_CURSOR.execute("SELECT TeamLimit FROM Season WHERE SeasonID = 3")
queryResult = TRASH_CURSOR.fetchall()
print("Team Limit: " + str(queryResult[0][0]))
teamLimit = queryResult[0][0]



#pull waiver prio list
TRASH_CURSOR.execute("SELECT Value FROM Static WHERE Name = 'WaiverPriority'")
queryResult = TRASH_CURSOR.fetchall()
print("Priority - " + str(queryResult[0][0]))
prio = str(queryResult[0][0]).split('-')

#funcs

#pull Player table for all players in current season
def RefreshPlayers():
    TRASH_CURSOR.execute("SELECT Player.PlayerID, Player.FantasyTeamID, Player.PlayStatus, Team.OwnerID FROM Player LEFT JOIN Team ON Player.FantasyTeamID = Team.TeamID WHERE FantasyTeamID != -2")
    queryResult = TRASH_CURSOR.fetchall()
    print(str(len(queryResult)) + " players fetched")
    return queryResult

players = RefreshPlayers()

def ValidateRequest(request):
    for i, playerId in enumerate(str(request[4]).split('-')):
        for j, player in enumerate(players):
            if (str(player[0]) != playerId):
                continue
            else:
                if (str(player[1]) != "0"):
                    return 3 #player unavailable
    
    pickupCount = len(str(request[4]).split('-'))
    giveCount = 0
    if (request[5] != None):
        for i, playerId in enumerate(str(request[5]).split('-')):
            for j, player in enumerate(players):
                if (str(player[0]) != playerId):
                    continue
                else:
                    if (str(player[3]) != str(request[1])):
                        return 3 #player unavailable
        giveCount = len(str(request[5]).split('-'))
    
    TRASH_CURSOR.execute("SELECT Player.PlayerID FROM Player JOIN Team ON Player.FantasyTeamID = Team.TeamID WHERE Team.OwnerID = " + str(request[1]))
    queryResult = TRASH_CURSOR.fetchall()
    teamCount = len(queryResult)

    if (teamCount - giveCount + pickupCount) > teamLimit:
        return 2 #team full
    
    return 1 #success


def ExecuteReq(request,cursor):
    print("Req:\n" + str(request))
    status = ValidateRequest(request)
    if (status == 1):
        cursor.execute("UPDATE Player SET FantasyTeamID = (SELECT TeamID FROM Team WHERE OwnerID = " + str(request[1]) + ") WHERE PlayerID IN (" + str(request[4]).replace('-',',') + ")")
        if (request[5] != None):
            cursor.execute("UPDATE Player SET FantasyTeamID = 0 WHERE PlayerID IN (" + str(request[5]).replace('-',',') + ")")
        cursor.execute("DELETE FROM Request WHERE RequestID = " + str(request[0]))
        drops = "NULL"
        if (request[5] != None):
            drops = str(request[5])
        cursor.execute("INSERT INTO RequestLog (RequestID,OwnerID,SeasonID,RequestTime,RequestType,RequestedPlayers,GivenPlayers,TradeOwner,RequestStatus) VALUES \
            (" + str(request[0]) + "," + str(request[1]) + ",3,'" + str(request[2]) + "'," + str(request[3]) + "," + str(request[4]) + "," + drops + ",0,1)")
        print("SUCCESS\n")
        return True
    else:
        cursor.execute("DELETE FROM Request WHERE RequestID = " + str(request[0]))
        dropsLog = str(request[5])
        if (dropsLog == "None"):
            dropsLog = "NULL"
        cursor.execute("INSERT INTO RequestLog (RequestID,OwnerID,SeasonID,RequestTime,RequestType,RequestedPlayers,GivenPlayers,TradeOwner,RequestStatus) VALUES \
            (" + str(request[0]) + "," + str(request[1]) + ",3,'" + str(request[2]) + "'," + str(request[3]) + "," + str(request[4]) + "," + dropsLog + ",0," + str(status) + ")")
        print("FAIL - CODE: " + str(status) + "\n")
        return False




#until requests are complete, run through for each owner in prio order and validate request, if valid - enact and set prio to last.
newWaiver = prio.copy()
toRemove = []
while(len(reqs) > 0):
    fullBreak = False
    for j, owner in enumerate(prio):
        if (fullBreak == True):
            break
        else:
            fullBreak = False
            for i, req in enumerate(reqs):
                if (str(req[1]) == str(owner)):
                    if (ExecuteReq(req,TRASH_CURSOR) == True):
                        newWaiver.remove(owner)
                        newWaiver.append(owner)
                        toRemove.append(reqs[i])
                        break
                    else:
                        toRemove.append(reqs[i])
                        fullBreak = True
                    TRASH_DB.commit()
                    players = RefreshPlayers()
        for i, obj in enumerate(toRemove):
            if (obj in reqs):
                reqs.remove(obj)
    prio = newWaiver


TRASH_CURSOR.execute("UPDATE Static SET Value = '" + "-".join(newWaiver) + "' WHERE Name = 'WaiverPriority'")
TRASH_DB.commit()

TRASH_DB.close()
                    
