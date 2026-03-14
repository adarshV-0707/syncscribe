import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../services/cloudinary.service.js";

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

