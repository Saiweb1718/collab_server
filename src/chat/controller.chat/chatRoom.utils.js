function getRoomId(type,payload){
    if(type="ONE_ON_ONE"){
        return([payload.userId1,payload.userId2].sort().join("_"))
    }

    if(type=="PROJECT"){
        return `project_${payload.projectId}`
    }
    if(type=="COMPANY"){
        return `company_${payload.companyId}`
    }

    throw new Error("Invalid chat room type")
}

module.exports = {getRoomId}