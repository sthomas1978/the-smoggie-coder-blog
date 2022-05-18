import * as React from 'react';
import { Disqus } from 'gatsby-plugin-disqus';


const Comments = (props) => { 
    return (
    <Disqus config={props}/>)
}

export default Comments;