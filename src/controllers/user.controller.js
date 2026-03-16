import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../services/cloudinary.service.js";
import jwt from "jsonwebtoken"

const generateAccessAndRefreshTokens = async(userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()
        user.refreshToken = refreshToken
        await user.save({validateBeforeSave: false})
        return {accessToken,refreshToken}
        
    } catch (error) {
         throw new ApiError(500, "Something went wrong while generating refresh and access tokens")
 
    }
}

const registerUser = asyncHandler(async(req,res) => {
    const {name,email,username,password} = req.body
    if(
        [name,email,username,password].some((field)=> !field|| field?.trim()==="")
    ){
        throw new ApiError(400,"All fields are required")
    }

    const existedUser = await User.findOne(
        {
            $or: [{username}, {email}]
        }
    )

    if(existedUser){
        throw new ApiError(400,"User with email or username already exists")
    }

    const avatarLocalPath = req.files?.avatar[0]?.path;
    if(!avatarLocalPath){
        throw new ApiError(400,"Avatar file is required")

    }

     const avatar = await uploadOnCloudinary(avatarLocalPath)


    if(!avatar){
        throw new ApiError(500,"Avatar upload failed!!")
    }

    const user = await User.create({
        name,
        avatar:avatar.url,
        email:email.toLowerCase(),
        password,
        username:username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500,"Something went wrong while registering the user")
    }

    return res
    .status(201)
    .json
    (new ApiResponse(201,createdUser,"User registered successfully"))


    


})

const loginUser = asyncHandler(async (req,res) => {
    const {email,username,password} = req.body;
    if(!username && !email) {
        throw new ApiError(400,"Username or email is required")

    }
    const user = await User.findOne({
        $or: [{username},{email}]
    })
    if(!user){
        throw new ApiError(404,"User does not exist")
    }

    const isPasswordValid = await user.isPasswordCorrect(password)

    if(!isPasswordValid){
        throw new ApiError(400,"Incorrect password")
    }

     const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)

   const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

   const options = {
     httpOnly: true,
     secure: true
   }

   return res
   .status(200)
   .cookie("accessToken", accessToken, options)
   .cookie("refreshToken",refreshToken,options)
   .json(
    new ApiResponse(
      200,
      {
        user: loggedInUser, accessToken,refreshToken
      },
      "User logged in successfully"
    )
   )
})

const logoutUser = asyncHandler(async(req,res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset:{
                refreshToken:1
            }
        },

        {
            new : true
        }
    )

    const options = {
    httpOnly: true,
    secure: true
   }

   return res
   .status(200)
   .clearCookie("accessToken",options)
   .clearCookie("refreshToken",options)
   .json(new ApiResponse(200,{},"User logged out successfully"))
})

const refreshAccessToken = asyncHandler(async(req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorised request")
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET
        )

        const user = await User.findById(decodedToken?._id)

        if (!user) {
            throw new ApiError(401, "User not found, token is invalid")  
        }

        if (incomingRefreshToken !== user?.refreshToken) {  
            throw new ApiError(401, "Refresh token is expired or used")
        }

        const options = {
            httpOnly: true,
            secure: true
        }

        const { accessToken, refreshToken: newRefreshToken } = 
            await generateAccessAndRefreshTokens(user._id)

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    { accessToken, refreshToken: newRefreshToken },
                    "Access token refreshed successfully"
                )
            )

    } catch (error) {
        throw new ApiError(401, error?.message || "Something went wrong while refreshing access token")  
    }
})

const changeCurrentPassword = asyncHandler(async(req,res) => {
    const {oldPassword , newPassword} = req.body
    if(!oldPassword || !newPassword) {
    throw new ApiError(400, "All fields are required")
    }

    if(oldPassword === newPassword) {
    throw new ApiError(400, "New password cannot be same as old password")
    }

    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400,"Incorrect old password")
    }
    user.password = newPassword;

    await user.save({validateBeforeSave:false})

    return res
    .status(200)
    .json(new ApiResponse(200,{},"Password changed successfully"))

})

const getCurrentUser = asyncHandler(async(req,res)=>{
  return res
  .status(200)
  .json(new ApiResponse(200,req.user,"current user fetched successfully"))
})

const updateAccountDetails = asyncHandler(async(req, res) => {
    const { name, email } = req.body

    if(!name?.trim() || !email?.trim()) {
        throw new ApiError(400, "All fields are required")
    }

    const existingUser = await User.findOne({
        email,
        _id: { $ne: req.user._id }
    })

    if(existingUser) {
        throw new ApiError(409, "Email already in use")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                name,
                email
            }
        },
        { new: true }
    ).select("-password -refreshToken")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async(req,res)=>{
  const avatarLocalPath = req.file?.path

  if(!avatarLocalPath){
    throw new ApiError(400,"Avatar file is missing")
  }

  const avatar = await  uploadOnCloudinary(avatarLocalPath)

  if(!avatar.url){
    throw new ApiError(500,"Error while uploading avatar")
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set:{
        avatar:avatar.url
      }
    },
    {new:true}
  ).select("-password -refreshToken")

  return res
  .status(200)
  .json(new ApiResponse(200,user,"Avatar updated successfully"))
})

const getUserProfile = asyncHandler(async(req,res) => {
    const {username} = req.params

    if(!username?.trim()){
    throw new ApiError(400,"Username is missing")
    } 

    const profile = await User.aggregate([
        {
            $match:{
                username:username?.toLowerCase()
            },
        },
        {
            $project:{
                name:1,
                username:1,
                avatar:1,
            }
        }
        
    
    ])
    
    if(!profile?.length) {
    throw new ApiError(404, "User not found")
}
    return res
    .status(200)
    .json(new ApiResponse(200,profile[0],"User profile fetched successfully"))

})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    getUserProfile
}






