import { compare } from "bcrypt";
import {User} from "../models/user.js"
import { cookieOption, emitEvent, sendToken, uploadFilesToCloudinary } from "../utils/features.js";
import { TryCatch } from "../middlewares/error.js";
import { ErrorHandler } from "../utils/utility.js";
import { Chat } from "../models/chat.js";
import { Request } from "../models/request.js";
import { NEW_REQUEST, REFTCH_CHATS } from "../constants/events.js";
import { getOtherMember } from "../lib/helper.js";




const newUser = TryCatch(async (req, res)=>{
    const {name, username, password, bio} = req.body;
    
    //console.log(req.body);
    
   

   const file = req.file;
   // console.log(file);

   if(!file) return next(new ErrorHandler("Please upload file"), 400)


      const result = await uploadFilesToCloudinary([file])

     const avatar = {
         public_id: result[0].public_id,
         url: result[0].url,
      }
    
    const user = await User.create({
           name,
           username,
           password,
           bio,
           avatar, 
     })



    //res.status(201).json({message: "User Created Sucessfuly"});
    sendToken(res, user, 201, "User created"); 
});


const login = TryCatch(async(req, res, next)=>{
    const {username, password} = req.body;
    const user = await User.findOne({username}).select("+password");
    if(!user) return next(new ErrorHandler("Invalid username", 404));
    const isMatch = await compare(password, user.password);
    if(!isMatch)  return next(new ErrorHandler("Invalid passWord", 404));
    sendToken(res, user, 200, `Welcome back ${user.name}`);          
})

const getMyProfile = TryCatch(async(req, res, next) => {
   const user =  await User.findById(req.user);
    if(!user) return next(new ErrorHandler("User Not Fount"), 404);
    res.status(200).json({
     success: true,
     user, 
  })
});


const logout = TryCatch(async(req, res) => { 
 return res.cookie("wellBoom-token", "", {...cookieOption, maxAge: 0}).json({
    success: true,
    message: "Logout Succesfully",
 });
});

const searchUser = TryCatch(async (req, res) => { 
   console.log("route has been hit");

   const { name = "" } = req.query;

   try {
       const myChats = await Chat.find({ groupChat: false, members: req.user });

       const allUsersFromMyChats = myChats.map((chat) => chat.members);

       const usersToExclude = allUsersFromMyChats.flat(); 

       const users = await User.find({ 
           _id: { $nin: usersToExclude }, 
           name: { $regex: name, $options: "i" } 
       });

       const formattedUsers = users.map(({ _id, name, avatar }) => ({
           _id,
           name,
           avatar: avatar ? avatar.url : null 
       }));

       return res.json({
           success: true,
           users: formattedUsers
       });
   } catch (error) {
       console.error("Error in searching users:", error);
       return res.status(500).json({ success: false, error: "Internal server error" });
   }
});




 const sendFriendRequest = TryCatch(async(req, res, next) => { 
     
   
   const {userId} = req.body;

   const  request = await Request.findOne({
    
       $or: [
         {sender: req.user, receiver: userId},
         {sender: userId, receiver: req.user },
       ]

      }
   )

   
   if(request) return next(new ErrorHandler("Request already sent", 400));

   await Request.create({
        sender: req.user,
        receiver: userId, 
   })

   emitEvent(req, NEW_REQUEST, [userId]);

   return res.status(200).json({          
      success: true,
      message: "Friend Request Sent"
   })

  });


  const acceptFriendRequesst = TryCatch(async(req, res, next) => { 

   

    const {requestId, accept} = req.body;

    const request = await Request.findById(requestId)
    .populate("sender", "name")
    .populate("receiver", "name")
  
   if(!request) return next( new ErrorHandler("Request Not Found", 404));

      
   if(request.receiver._id.toString() !== req.user.toString())
    return next( new ErrorHandler("You Are not authorize to accept this request", 404));

    if(!accept){
      await request.deleteOne();
      return res.status(200).json({
         success: true,
         message: "Friend request rejcted"
      })
    }

    const members = [request.sender._id, request.receiver._id];

    await Promise.all([
      Chat.create({
         members,
         name: `${request.sender.name}-${request.receiver.name}`
      }),
      request.deleteOne(),
    ])


    emitEvent(req, REFTCH_CHATS, members);

   return res.json({
      success: true,
      message: "Friend Request Accepted",
      senderId: request.sender._id,
   });
  });


const getAllNotifications = TryCatch(async(req, res) => { 
  const request = await Request.find({receiver: req.user})
  .populate("sender", "name avatar");

  const allRequst  = request.map(({_id, sender}) => ({
  _id,
   sender: {  
      _id: sender._id,
      name: sender.name,
      avatar: sender.avatar.url
   }
  }))
 
  return res.status(200).json({
   sucess: true,
   allRequst,
  })
});



// const getMyFriends = async(req, res) => {

//    const chatId = req.query.chatId;

//    const chats = await Chat.find({
//         members: req.user,
//         groupChat: false,      
//    }).populate("members", "name avatar")
   
    
//       const friends = chats.map(({members}) => {
//       const otherUser =  getOtherMember(members, req.user);

//       console.log(otherUser.name)
          
//       // return{
//       //    _id: otherUser._id,
//       //    name: otherUser.name,
//       //    avatar: otherUser.avatar.url
//       // }
//    });
 

//    if(chatId){

//       const chat = await Chat.findById(chatId);
//       const availableFriends = friends.filter((friend) => !chat.members.includes(friend._id));
      
//       return res.status(200).json({
//          sucess: true,
//          friends: availableFriends,     
//         })
       
//    }                                        
//    else{
//       return res.status(200).json({
 
//          sucess: true,
//          friends,
      
//         })
//    }
   
   
 
//  };


const getMyFriends = async (req, res) => {
   const chatId = req.query.chatId;

   const chats = await Chat.find({
      members: req.user,
      groupChat: false,
   }).populate("members", "name avatar");

   const friends = chats.map(({ members }) => {
      const otherUser = getOtherMember(members, req.user);
      if (otherUser) {
         return {
            _id: otherUser._id,
            name: otherUser.name,
            avatar: otherUser.avatar.url,
         };
      } else {
         
         return {
            _id: null,
            name: "Unknown",
            avatar: "",
         };
      }
   });

   if (chatId) {
      const chat = await Chat.findById(chatId);
      const availableFriends = friends.filter((friend) => !chat.members.includes(friend._id));

      return res.status(200).json({
         success: true,
         friends: availableFriends,
      });
   } else {
      return res.status(200).json({
         success: true,
         friends,
      });
   }
};


export { login, newUser, getMyProfile, logout, searchUser, sendFriendRequest,
    acceptFriendRequesst, getAllNotifications, getMyFriends };