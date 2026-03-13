import mongoose,{Schema} from 'mongoose';

const userSchema  = new Schema(
    {
        name:{
            type:String,
            required:true,
        },
        username:{
            type:String,
            required:true,
            unique:true,
            lowercase:true,
            trim:true,
            index:true,
        },
        email:{
            type:String,
            required:true,
            unique:true,
            lowercase:true,
            trim:true,
            index:true,
        },
        password:{
            type:String,
            required:[true,"Password is required"]
        },
        avatar:{
            type:String,
            required:true,
        },
        refreshToken:{
            type:String,

        },
        isActive:{
            type:Boolean,
            default:true
        }

    },
    {
        timestamps:true
    }
)

export const User = mongoose.model("User",userSchema)